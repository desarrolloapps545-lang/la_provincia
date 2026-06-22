// Credenciales de conexión proporcionadas
const SUPABASE_URL = "https://zvxnksnsovtlczausrvl.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2eG5rc25zb3Z0bGN6YXVzcnZsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY3Nzc0NSwiZXhwIjoyMDkxMjUzNzQ1fQ.ai6JYAE43_HCmIXTR6McoTHkEi0wYuMszqCQn-pMhaA";
// IMPORTANTE: La clave anterior es la service_role_key y NO debe ser expuesta en el frontend.
// Para operaciones de cliente y llamadas a Edge Functions, se debe usar la anon public key.
const SUPABASE_ANON_PUBLIC_KEY = "TU_SUPABASE_ANON_PUBLIC_KEY_AQUI"; // <--- DEBES REEMPLAZAR ESTO CON TU CLAVE ANON PUBLIC

// Inicialización del cliente de Supabase (Ingeniería de Backend en el Cliente)
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let CURRENT_USER_ROLE = "";
window.CURRENT_INVENTORY_MODE = "products";

// Variable global para trackear el orden de selección en fórmulas
let selectedFormulaFields = [];

// Ingeniería de Backend en Frontend: Helper para obtener fecha/hora de Colombia (timestamp sin zona horaria)
const getColombiaTimestamp = () => {
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date()).replace('T', ' ');
};

// Ingeniería de Sistemas: Helper para normalización de texto (quitar acentos y minúsculas)
const normalizeText = (str) => {
    if (str === null || str === undefined) return "";
    return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
};

// Ingeniería de Frontend: Helper para formateo de millares con puntos (.)
const formatNumber = (num) => {
    if (num === null || num === undefined) return "0";
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

const parseInventoryAmount = (amount) => {
    if (amount === null || amount === undefined) return { units: 0, kg: 0 };
    if (typeof amount === 'object') {
        return {
            units: Number(amount.units) || 0,
            kg: Number(amount.kg) || 0
        };
    }
    if (typeof amount === 'string') {
        try {
            const parsed = JSON.parse(amount);
            if (typeof parsed === 'object' && parsed !== null) {
                return {
                    units: Number(parsed.units) || 0,
                    kg: Number(parsed.kg) || 0
                };
            }
        } catch (_) {
            const parts = amount.split('|').map(part => part.trim());
            if (parts.length === 2 && !Number.isNaN(Number(parts[0])) && !Number.isNaN(Number(parts[1]))) {
                return { units: Number(parts[0]), kg: Number(parts[1]) };
            }
        }
    }
    const numeric = Number(amount);
    return { units: Number.isNaN(numeric) ? 0 : numeric, kg: 0 };
};

const formatInventoryAmount = (amount) => {
    const parsed = parseInventoryAmount(amount);
    if (parsed.kg !== 0) {
        return `${formatNumber(parsed.units)} / ${formatNumber(parsed.kg)} KG`;
    }
    return formatNumber(parsed.units);
};

const adjustInventoryAmount = (current, delta, isAdd = true) => {
    const base = parseInventoryAmount(current);
    const unitsDelta = Number(delta.units) || 0;
    const kgDelta = Number(delta.kg) || 0;
    return {
        units: base.units + (isAdd ? unitsDelta : -unitsDelta),
        kg: base.kg + (isAdd ? kgDelta : -kgDelta)
    };
};

const getNumericFieldValue = (input) => {
    if (!input) return 0;
    const raw = String(input.value || "").replace(/\s+/g, '').replace('%', '').replace(',', '.');
    const parsed = parseFloat(raw);
    if (Number.isNaN(parsed)) return 0;
    return input.dataset.displayFormat === 'percent' ? parsed / 100 : parsed;
};

const computeFormulaResult = (op, targets, fieldValues) => {
    const val1 = fieldValues[targets[0]] || 0;
    const val2 = targets.length === 2 ? (fieldValues[targets[1]] || 0) : 0;
    const baseValue = fieldValues['Peso Inicial'] || 0;

    if (op === 'formula_sum') {
        return targets.reduce((sum, label) => sum + (fieldValues[label] || 0), 0);
    }

    if (op === 'formula_diff') {
        if (targets.length === 1) {
            return baseValue - val1;
        }
        return val1 - val2;
    }

    if (op === 'formula_add') {
        if (targets.length === 1) {
            return baseValue + val1;
        }
        return val1 + val2;
    }

    if (op === 'formula_div') {
        if (targets.length === 1) {
            return baseValue !== 0 ? val1 / baseValue : 0;
        }
        return val2 !== 0 ? val1 / val2 : 0;
    }

    return 0;
};

// Ingeniería de Sistemas: Generador de código correlativo automático
const generateNextProductCode = async () => {
    const { data, error } = await _supabase
        .from('products')
        .select('code')
        .order('code', { ascending: false })
        .limit(1);

    if (error || !data || data.length === 0) {
        return "100001";
    }

    let nextCode = parseInt(data[0].code) + 1;
    // Regla: si llega a X00000, pasa a X00001 (ej: 199999 -> 200001)
    if (nextCode % 100000 === 0) nextCode++;
    return String(nextCode);
};

const updateProductTotalProjection = () => {
    const unit = parseFloat(document.getElementById('prodUnit')?.value) || 0;
    const buyPrice = parseInt(document.getElementById('prodBuyPrice')?.value.replace(/\./g, '')) || 0;
    const projection = unit * buyPrice;
    if (document.getElementById('prodTotalProjection')) document.getElementById('prodTotalProjection').textContent = `$ ${formatNumber(projection)}`;
};

// Ingeniería de Frontend: Sistema de mensajes temporales Toast
const showToast = (message, type = 'success') => {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error-bg' : ''}`;
    toast.style.backgroundColor = type === 'error' ? '#d63031' : '#00b894';
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => { toast.remove(); }, 3000);
};

// Ingeniería de Sistemas: Manejo de Persistencia de Sesión y Datos de Acceso
document.addEventListener('DOMContentLoaded', async () => {
    // Inicializar listeners para el modal de edición de inventario
    setupEditInventoryListeners();
    
    // Listener dinámico para mostrar u ocultar checklist de campos en fórmulas
    document.getElementById('newFieldOp')?.addEventListener('change', async function() {
        const op = this.value;
        selectedFormulaFields = []; // Resetear selección al cambiar operación
        const container = document.getElementById('formulaFieldsContainer');
        const adjCheckbox = document.getElementById('newFieldAllowAdjustment');
        const checklist = document.getElementById('formulaFieldsChecklist');
        const formatContainer = document.getElementById('displayFormatContainer');

        if (op.startsWith('formula_')) {
            container.classList.remove('hidden');
            if(adjCheckbox) adjCheckbox.checked = false;
            if(formatContainer) formatContainer.classList.toggle('hidden', op !== 'formula_div');
            
            const animalName = document.getElementById('modalConfigAnimalFields').dataset.animal;
            
            // Ingeniería de Datos: Consultar campos de AMBOS formularios para permitir cruce en División
            const { data: fields } = await _supabase.from('animal_config').select('field_label, form_type').eq('animal_name', animalName);
            
            // Añadir "Peso Inicial" manualmente a las opciones seleccionables
            const allFields = [{ field_label: 'Peso Inicial' }, ...(fields || [])];

            checklist.innerHTML = allFields.map(f => `
                <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: #2d3436; margin: 0;">
                    <input type="checkbox" class="formula-checkbox" value="${f.field_label}" style="width: auto; margin: 0;" onchange="handleFormulaFieldClick(this, '${op}')">
                    ${f.field_label} ${f.form_type ? `<small style="color:#b2bec3;">(${f.form_type})</small>` : ''}
                </label>
            `).join('') || '<span style="font-size:11px; color:#b2bec3;">No hay campos previos configurados.</span>';
        } else {
            container.classList.add('hidden');
            checklist.innerHTML = '';
        }
    });

    // 1. Cargar datos recordados
    const savedEmail = localStorage.getItem('rememberedEmail');
    const savedPass = localStorage.getItem('rememberedPass');
    if (savedEmail && savedPass) {
        document.getElementById('email').value = savedEmail;
        document.getElementById('password').value = savedPass;
        document.getElementById('rememberMe').checked = true;
    }

    // Listener para habilitar/deshabilitar el campo de peso en productos
    document.getElementById('prodHasWeight')?.addEventListener('change', function() {
        const container = document.getElementById('prodWeightContainer');
        if (container) {
            container.classList.toggle('hidden', !this.checked);
            if (!this.checked) document.getElementById('prodWeight').value = "";
        }
    });

    // 2. Verificar sesión activa (Evitar cierre al recargar)
    const { data: { session } } = await _supabase.auth.getSession();
    if (session) {
        const { data: userData } = await _supabase
            .from('users')
            .select('role')
            .eq('id', session.user.id)
            .single();
        
        if (userData) {
            CURRENT_USER_ROLE = userData.role;
            initWorkspace(userData.role);
        }
    }
});

const loginForm = document.getElementById('loginForm');
const feedback = document.getElementById('authFeedback');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const remember = document.getElementById('rememberMe').checked;

    feedback.textContent = "Autenticando...";
    feedback.className = "";

    // Implementación del método de autenticación mediante correo y contraseña
    const { data, error } = await _supabase.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        feedback.textContent = `Error: ${error.message}`;
        feedback.className = "error-msg";
    } else {
        // FASE 2: Rectificación de identidad en tabla 'users' y validación de rol.
        // Se realiza la consulta al perfil del usuario en la tabla 'users'.
        const { data: userData, error: dbError } = await _supabase
            .from('users')
            .select('role')
            .eq('id', data.user.id)
            .single();

        if (dbError) {
            // Diagnóstico mejorado para errores de base de datos (incluyendo posibles 500 del servidor)
            console.error("Error al consultar la tabla 'users':", dbError);
            if (dbError.code === 'PGRST100' || (dbError.message && dbError.message.includes('permission denied'))) {
                feedback.textContent = "Error de acceso a la base de datos: Posiblemente un problema con las políticas de Row Level Security (RLS) en la tabla 'users'. Por favor, verifica tu configuración de RLS en Supabase.";
            } else if (dbError.message && (dbError.message.includes('invalid key') || dbError.message.includes('authentication failed'))) {
                feedback.textContent = "Error de autenticación de la API: La clave de Supabase podría ser incorrecta o no tener los permisos adecuados. Por favor, verifica tu clave 'anon public key' en la configuración de tu proyecto Supabase.";
            } else {
                feedback.textContent = `Error al consultar el perfil de usuario en la base de datos: ${dbError.message}. Por favor, verifica la tabla 'users' y sus políticas de RLS.`;
            }
            feedback.className = "error-msg";
            await _supabase.auth.signOut();
            return;
        }

        const rolesPermitidos = ["Administrador", "Usuario", "Desarrollador"];
        
        if (!userData) {
            // Este caso se da si no hay error de DB pero userData es null (ej. no se encontró el ID)
            feedback.textContent = "Error: El usuario autenticado no tiene un perfil asociado en la tabla 'users' de la base de datos.";
            feedback.className = "error-msg";
            await _supabase.auth.signOut();
            return;
        }
        if (rolesPermitidos.includes(userData.role)) {
            feedback.textContent = `Inicio exitoso. Rol identificado: ${userData.role}`;
            feedback.className = "success-msg";
            
            if (remember) {
                localStorage.setItem('rememberedEmail', email);
                localStorage.setItem('rememberedPass', password);
            } else {
                localStorage.removeItem('rememberedEmail');
                localStorage.removeItem('rememberedPass');
            }

            CURRENT_USER_ROLE = userData.role;
            // Transición al Workspace
            initWorkspace(userData.role);
        } else {
            feedback.textContent = "Error: Acceso denegado. Rol no autorizado para el sistema.";
            feedback.className = "error-msg";
            await _supabase.auth.signOut();
        }
    }
});

// Lógica para conmutar la visibilidad de la contraseña
const togglePassword = document.getElementById('togglePassword');
const passwordInput = document.getElementById('password');

togglePassword.addEventListener('click', function () {
    const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordInput.setAttribute('type', type);
    
    // Opcional: Cambio visual del icono (Feedback de estado)
    this.style.color = type === 'text' ? '#00b894' : '#636e72';
});

// FASE 3.1: Ingeniería de Interfaz del Workspace
async function initWorkspace(role) {
    document.querySelector('.login-container').classList.add('hidden');
    const workspace = document.getElementById('mainWorkspace');
    workspace.classList.remove('hidden');

    // Ingeniería de Backend: Obtención de datos del perfil para personalización de interfaz
    const { data: { user } } = await _supabase.auth.getUser();
    const { data: profile } = await _supabase.from('users').select('name, farm').eq('id', user.id).single();

    if (profile) {
        window.CURRENT_USER_FARM = profile.farm;
        const profileInfo = document.getElementById('userProfileInfo');
        profileInfo.innerHTML = `
            <div style="text-align: left; line-height: 1.2; font-size: 13px; border-left: 1px solid #4b4b4b; padding-left: 15px; margin-left: 15px;">
                <div style="color: #00b894; font-weight: bold;">Granja: ${profile.farm || 'Todas'}</div>
                <div style="color: #ffffff;">Usuario: ${profile.name}</div>
            </div>
        `;
    }

    if (role === 'Usuario') {
        // Restricción de Navegación: Ocultar módulos administrativos
        document.getElementById('btnGestionUsuarios').classList.add('hidden');
        document.getElementById('btnGestionGranjas').classList.add('hidden');
        document.getElementById('btnGestionProveedores').classList.add('hidden');
        document.getElementById('btnGestionProductos').classList.add('hidden');

        // Restricción de Inventario: Ocultar botones de configuración y reportes (Kardex y Galpones)
        const invActions = document.querySelector('#inventoryView .action-bar').children;
        if (invActions[3]) invActions[3].classList.add('hidden'); // Registrar Galpón
        if (invActions[6]) invActions[6].classList.add('hidden'); // Kardex

        // Activación automática de la vista de inventario
        renderInventoryView('products');
    } else {
        await checkProvinceData();
        document.getElementById('welcomeMessage')?.classList.remove('hidden');
        loadFarms();
    }
}

/**
 * Ingeniería de Sistemas: Validación mandatoria de datos de franquicia
 */
async function checkProvinceData() {
    const { data, error } = await _supabase.from('province').select('*').maybeSingle();
    if (!data) {
        showModal('modalCreateProvince');
        // Bloqueo de cierre: Sobrescribimos closeModals temporalmente si es necesario
    }
}

document.getElementById('formCreateProvince')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const provinceData = {
        social_reason: document.getElementById('provSocialReason').value,
        nit: document.getElementById('provNit').value,
        email: document.getElementById('provEmail').value,
        phone: document.getElementById('provPhone').value,
        created_at: getColombiaTimestamp()
    };

    const { error } = await _supabase.from('province').insert([provinceData]);
    if (error) showToast("Error al guardar datos: " + error.message, "error");
    else {
        showToast("Configuración de franquicia completada");
        location.reload(); // Recarga para activar el sistema con normalidad
    }
});

// Manejo de Modales
function showModal(id) {
    const overlay = document.getElementById('modalOverlay');
    overlay.classList.remove('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    const modal = document.getElementById(id);
    modal.classList.remove('hidden');
    const isEdit = modal.querySelector('form')?.dataset.mode === 'edit';

    // Ingeniería de Sistemas: Resetear estado de edición al abrir como "Nuevo"
    const form = modal.querySelector('form');
    if (form) {
        const isEdit = form.dataset.mode === 'edit';
        if (!isEdit) {
            form.reset();
            delete form.dataset.mode;
            delete form.dataset.originalId;
            
            // Restaurar textos originales por defecto
            const title = modal.querySelector('h4');
            const submitBtn = form.querySelector('button[type="submit"]');
            if (id === 'modalCreateFarm') { title.textContent = "Nueva Granja"; submitBtn.textContent = "Guardar"; }
            if (id === 'modalCreateSupplier') { title.textContent = "Nuevo Proveedor"; submitBtn.textContent = "Guardar"; }
            if (id === 'modalCreateProduct') { 
                title.textContent = "Nuevo Producto"; 
                submitBtn.textContent = "Guardar"; 
                // Generar código automáticamente al abrir para nuevo producto
                generateNextProductCode().then(code => {
                    document.getElementById('prodCode').value = code;
                });
                document.getElementById('prodTotalProjection').textContent = "$ 0";
                
                // Resetear campos de peso
                const checkWeight = document.getElementById('prodHasWeight');
                if (checkWeight) {
                    checkWeight.checked = false;
                    document.getElementById('prodWeightContainer').classList.add('hidden');
                }
                const isAnimalCheck = document.getElementById('prodIsAnimal');
                if (isAnimalCheck) isAnimalCheck.checked = false;
            }
            if (id === 'modalCreateShed') { title.textContent = "Nuevo Galpón"; submitBtn.textContent = "Guardar Galpón"; }
        }
    }

    if(id === 'modalOutboundAnimal') prepareOutboundAnimalModal();
    if(id === 'modalCreateUser') prepareRoleDropdown();
    if(id === 'modalUpdateData') prepareUpdateFields();
    if(id === 'modalCreateSupplier') loadProductsForSelect(); // Esta línea es correcta, carga productos para proveedores.
    if(id === 'modalInboundInventory') prepareInboundModal();
    if(id === 'modalOutboundInventory') prepareOutboundModal();
    if(id === 'modalCreateShed') prepareShedModal();
    if(id === 'modalListCategories') renderCategoriesList();
    if(id === 'modalInboundAnimal') prepareInboundAnimalModal();
}

function closeModals() {
    document.getElementById('modalOverlay').classList.add('hidden');
}

async function loadFarms() {
    // Consulta explícita a la tabla 'farms' columna 'name'
    const { data, error } = await _supabase.from('farms').select('name');
    
    if (error) console.error("Error al cargar granjas:", error.message);

    const selects = [document.getElementById('newFarm'), document.getElementById('updFarm')];
    selects.forEach(sel => {
        // Mapeo de la columna 'name' para cada fila encontrada
        sel.innerHTML = data?.length 
            ? '<option value="" disabled selected hidden>Seleccionar granja...</option>' + data.map(f => `<option value="${f.name}">${f.name}</option>`).join('') 
            : '<option value="">No hay granjas disponibles</option>';
            
        if(!data?.length) sel.disabled = true;
    });
}

async function prepareUpdateFields() {
    // Ingeniería de Backend: Recuperamos los datos actuales para no enviar campos vacíos
    const { data: { user } } = await _supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await _supabase
        .from('users')
        .select('name, cedula, farm')
        .eq('id', user.id)
        .single();

    if (data) {
        document.getElementById('updName').value = data.name || '';
        document.getElementById('updCedula').value = data.cedula || '';
        document.getElementById('updFarm').value = data.farm || '';
    }
}

function prepareRoleDropdown() {
    const roleSelect = document.getElementById('newRole');
    const hierarchy = {
        'Desarrollador': ['Desarrollador', 'Administrador', 'Usuario'],
        'Administrador': ['Administrador', 'Usuario'],
        'Usuario': []
    };
    const available = hierarchy[CURRENT_USER_ROLE] || [];
    roleSelect.innerHTML = available.map(r => `<option value="${r}">${r}</option>`).join('');
}

// Llamadas a Edge Function
async function callUserEdge(action, userData) {
    /**
     * Ingeniería de Sistemas: Al usar service_role_key en el cliente, el método invoke 
     * puede tener conflictos de cabeceras. Obtenemos el JWT manualmente para asegurar 
     * que la Edge Function pueda validar al 'requester'.
     */
    const { data: { session } } = await _supabase.auth.getSession();
    
    if (!session) {
        return { error: "Debe iniciar sesión para realizar esta acción." };
    }

    const { data, error } = await _supabase.functions.invoke('manage_users', {
        body: { action, userData },
        headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": SUPABASE_ANON_PUBLIC_KEY // Usamos la clave anon public para el cliente
        }
    });

    if (error) {
        console.error("Error en la invocación de la Edge Function:", error);
        return { error: error.message };
    }
    return data;
}

// Eventos de Formulario
document.getElementById('formCreateUser').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const role = document.getElementById('newRole').value;
    const farm = document.getElementById('newFarm').value;

    // Ingeniería de Sistemas: Validación mandatoria para Rol Usuario
    if (role === 'Usuario') {
        if (!farm || farm === "" || farm === "No hay granjas disponibles" || farm === "Todas las granjas") {
            showToast("Error: Requisito obligatorio asignar una granja para rol 'Usuario'.", "error");
            return;
        }
    }

    const userData = {
        name: document.getElementById('newName').value,
        email: document.getElementById('newEmail').value,
        password: document.getElementById('newPass').value,
        cedula: document.getElementById('newCedula').value,
        farm: farm,
        role: role
    };

    const res = await callUserEdge('createUser', userData);
    if(res.error) showToast("Error: " + res.error, "error");
    else { 
        showToast("Usuario creado exitosamente"); 
        closeModals(); 
        document.getElementById('btnGestionUsuarios').click(); 
    }
});

document.getElementById('formUpdatePass').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await callUserEdge('updatePassword', { password: document.getElementById('updPass').value });
    if(res.error) showToast("Error: " + res.error, "error");
    else { showToast("Contraseña actualizada correctamente"); closeModals(); }
});

document.getElementById('formUpdateData').addEventListener('submit', async (e) => {
    e.preventDefault();
    // Ingeniería de Sistemas: Delegamos la actualización a la Edge Function.
    // Esto garantiza que la operación se realice con privilegios de administrador (bypassing RLS).
    const res = await callUserEdge('updateData', {
        name: document.getElementById('updName').value,
        cedula: document.getElementById('updCedula').value,
        farm: document.getElementById('updFarm').value
    });

    if(res.error) {
        showToast("Error al actualizar: " + res.error, "error");
    } else {
        showToast("Datos actualizados correctamente");
        closeModals();
        // Refrescamos la UI si es necesario
        if (document.getElementById('usersView').classList.contains('hidden') === false) {
            document.getElementById('btnGestionUsuarios').click();
        }
    }
});

document.getElementById('btnGestionUsuarios').addEventListener('click', async () => {
    document.getElementById('welcomeMessage')?.classList.add('hidden');
    const usersView = document.getElementById('usersView');
    document.getElementById('farmsView')?.classList.add('hidden');
    document.getElementById('suppliersView')?.classList.add('hidden');
    document.getElementById('productsView')?.classList.add('hidden');
    document.getElementById('inventoryView')?.classList.add('hidden');
    usersView.classList.remove('hidden');
    
    const tableContainer = document.getElementById('tableContainer');
    tableContainer.innerHTML = "<p style='padding:20px;'>Cargando datos de personal...</p>";

    // Ingeniería de Backend: Invocamos la Edge Function para obtener la lista global
    // Esto asegura que veamos todos los registros independientemente de las políticas RLS del cliente.
    const res = await callUserEdge('listUsers', {});

    if (res.error) {
        tableContainer.innerHTML = `<p class="error-msg">Error al obtener usuarios: ${res.error}</p>`;
        return;
    }

    renderUsersTable(res);
});

function renderUsersTable(users) {
    const tableContainer = document.getElementById('tableContainer');
    
    let html = `
        <table>
            <thead>
                <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>Granja</th>
                    <th>Rol</th>
                    <th>Cédula</th>
                </tr>
            </thead>
            <tbody>
                ${users.map(u => `
                    <tr>
                        <td>${u.name || 'N/A'}</td>
                        <td>${u.email || 'N/A'}</td>
                        <td>${u.farm || 'N/A'}</td>
                        <td>${u.role}</td>
                        <td>${u.cedula || 'N/A'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    
    tableContainer.innerHTML = html;
}

async function loadFilteredProducts() {
    const search = normalizeText(document.getElementById('searchProductInput')?.value);
    const tableContainer = document.getElementById('productsTableContainer');

    if (!search) {
        tableContainer.innerHTML = "<p style='padding:40px; text-align:center; color:#636e72;'>Realice una búsqueda o seleccione una categoría para ver los productos</p>";
        return;
    }

    tableContainer.innerHTML = "<p style='padding:20px;'>Cargando productos...</p>";

    let query = _supabase.from('products').select('*');

    const { data, error } = await query;
    if (error) {
        tableContainer.innerHTML = `<p class="error-msg">Error: ${error.message}</p>`;
        return;
    }

    let filtered = data || [];
    if (search) {
        filtered = filtered.filter(p => 
            normalizeText(p.name).includes(search) || 
            normalizeText(p.code).includes(search)
        );
    }
    renderProductsTable(filtered);
}

// FASE 8.2: Gestión de Galpones (Creación y Autonumeración)
async function loadAnimalsForShed(farmName) {
    const animalSelect = document.getElementById('shedAnimal');
    if (!farmName) {
        animalSelect.innerHTML = '<option value="">Seleccione primero una granja...</option>';
        return;
    }

    const { data: farmData, error } = await _supabase
        .from('farms')
        .select('animals')
        .eq('name', farmName)
        .single();

    if (error) {
        console.error("Error al cargar animales de la granja:", error);
        animalSelect.innerHTML = '<option value="">Error al cargar animales</option>';
        return;
    }

    if (farmData && Array.isArray(farmData.animals) && farmData.animals.length > 0) {
        animalSelect.innerHTML = '<option value="">Seleccione animal...</option>' + 
            farmData.animals.map(a => `<option value="${a}">${a}</option>`).join('');
    } else {
        animalSelect.innerHTML = '<option value="">No hay animales configurados para esta granja</option>';
    }
}

async function prepareShedModal() {
    const farmSelect = document.getElementById('shedFarm');
    const animalSelect = document.getElementById('shedAnimal');
    const isEdit = document.getElementById('formCreateShed').dataset.mode === 'edit';
    
    const { data: farms } = await _supabase.from('farms').select('name').order('name');
    farmSelect.innerHTML = '<option value="">Seleccione granja...</option>' + 
        (farms?.map(f => `<option value="${f.name}">${f.name}</option>`).join('') || '');

    animalSelect.innerHTML = '<option value="">Seleccione primero una granja...</option>';
    
    if (!isEdit) document.getElementById('shedNumber').value = "";
}

document.getElementById('shedFarm')?.addEventListener('change', async function() {
    const farmName = this.value;
    if (!farmName) return;

    if (document.getElementById('formCreateShed').dataset.mode !== 'edit') {
        const { data } = await _supabase.from('sheds').select('id').eq('farm', farmName);
        const nextNumber = (data?.length || 0) + 1;
        document.getElementById('shedNumber').value = nextNumber;
    }

    await loadAnimalsForShed(farmName);
});

document.getElementById('formCreateShed')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const form = e.target;
    const isEdit = form.dataset.mode === 'edit';
    
    const shedData = {
        number: parseInt(document.getElementById('shedNumber').value),
        farm: document.getElementById('shedFarm').value,
        ability: parseInt(document.getElementById('shedAbility').value),
        animal: document.getElementById('shedAnimal').value,
    };

    let result;
    if (isEdit) {
        const [origFarm, origNum] = form.dataset.originalId.split('-');
        result = await _supabase.from('sheds').update(shedData).eq('farm', origFarm).eq('number', parseInt(origNum));
    } else {
        shedData.used = 0;
        shedData.created_at = getColombiaTimestamp();
        result = await _supabase.from('sheds').insert([shedData]);
    }

    const { error } = result;

    if (error) {
        showToast("Error al registrar galpón: " + error.message, "error");
    } else {
        showToast(isEdit ? "Galpón actualizado exitosamente" : "Galpón registrado exitosamente");
        closeModals();
        if (!document.getElementById('inventoryView').classList.contains('hidden')) {
            renderInventoryView('sheds');
        }
    }
});

// Ingeniería de Sistemas: Lógica de Cierre de Sesión
document.getElementById('btnLogout')?.addEventListener('click', async () => {
    const { error } = await _supabase.auth.signOut();
    if (error) showToast("Error al cerrar sesión: " + error.message, "error");
    else location.reload(); // Recarga la página para volver al estado de login
});

// FASE 6.2: Ingeniería de Inventario y Movimientos
async function prepareInboundModal() {
    const prodSelect = document.getElementById('inboundProduct');
    const extraFields = document.getElementById('inboundExtraFields');
    extraFields.classList.add('hidden');

    // Carga inicial de productos excluyendo aquellos marcados como animales
    let { data: prods } = await _supabase.from('products').select('name, unit, medit, code, animal').eq('animal', false).order('name');

    prodSelect.innerHTML = '<option value="" disabled selected hidden>Seleccione producto...</option>' + 
        prods.map(p => `<option value="${p.name}" data-unit="${p.unit}" data-medit="${p.medit}" data-code="${p.code}">${p.name}</option>`).join('');

    const { data: farms } = await _supabase.from('farms').select('name').order('name');
    const farmSelect = document.getElementById('inboundFarm');
    const provSelect = document.getElementById('inboundProvider');

    if (provSelect) {
        provSelect.innerHTML = '<option value="" disabled selected hidden>Seleccione el proveedor</option>';
    }

    if (farmSelect) {
        farmSelect.innerHTML = '<option value="" disabled selected hidden>Seleccionar granja...</option>' + 
            farms.map(f => `<option value="${f.name}">${f.name}</option>`).join('');

        // Lógica de Bloqueo por Granja Asignada
        if (window.CURRENT_USER_FARM && window.CURRENT_USER_FARM !== 'Todas las granjas') {
            farmSelect.value = window.CURRENT_USER_FARM;
            farmSelect.disabled = true;
        } else {
            farmSelect.disabled = false;
        }
    }
}

// Lógica de activación inmediata al seleccionar producto
document.getElementById('inboundProduct')?.addEventListener('change', async function() {
    const selected = this.options[this.selectedIndex];
    if (!selected.value) return;

    const productName = selected.value;
    const unitValue = selected.getAttribute('data-unit'); // Valor por unidad (ej: 50)
    const medit = selected.getAttribute('data-medit'); // Medida (ej: Kg)

    document.getElementById('inboundUnit').value = medit; // El campo inboundUnit ahora muestra la medida
    document.getElementById('inboundAvailable').value = formatNumber(unitValue);
    document.getElementById('inboundAvailable').dataset.initial = unitValue;
    document.getElementById('inboundExtraFields').classList.remove('hidden');
    document.getElementById('inboundUnid').value = "";
    document.getElementById('inboundShedContainer').classList.add('hidden'); // Ocultar galpón para ingreso de productos
    
    // Resetear selección de granja al cambiar producto
    const farmSelect = document.getElementById('inboundFarm');
    if (farmSelect) farmSelect.value = "";

    // Lógica de Proveedores Disponibles (Coincidencia exacta insensible a mayúsculas)
    const { data: provs } = await _supabase.from('providers').select('name, product');
    const availableProvs = provs.filter(p => 
        Array.isArray(p.product) && p.product.some(prod => prod.toLowerCase() === productName.toLowerCase())
    );

    const provSelect = document.getElementById('inboundProvider');
    provSelect.innerHTML = '<option value="" disabled selected hidden>Seleccione el proveedor</option>' + 
        availableProvs.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
});

// Ingeniería de Backend: Inicialización de registro por Granja al seleccionarla
document.getElementById('inboundFarm')?.addEventListener('change', async function() {
    const farmName = this.value;
    const prodSelect = document.getElementById('inboundProduct');
    const selected = prodSelect.options[prodSelect.selectedIndex];
    
    if (!farmName || !selected.value) return;

    const productName = selected.value;
    const unit = selected.getAttribute('data-unit');
    const code = selected.getAttribute('data-code');
    const medit = selected.getAttribute('data-medit');
    const fNameInit = document.getElementById('inboundFarm').value;

    // Carga de galpones dinámicos basados en la granja seleccionada
    const shedSelect = document.getElementById('inboundShed');
    const shed = shedSelect ? shedSelect.value : "";
    let query = _supabase
        .from('inventory')
        .select('product')
        .eq('product', productName)
        .eq('farm', fNameInit);
    
    if (shed) query = query.eq('shed', shed);
    const { data: existing } = await query.maybeSingle(); // This query is now only for non-animal products

    if (!existing) {
        const { error: invError } = await _supabase.from('inventory').insert([{
            code: code,
            product: productName,
            // categorie: category, // La categoría ya no se guarda en el inventario
            shed: shed || null,
            amount: 0,
            farm: farmName,
            provider: [],
            created_at: getColombiaTimestamp()
        }]);
        if (invError) console.error("Error al inicializar inventario en granja:", invError);
    }
});

// Ingeniería de Sistemas: Lógica de resta en tiempo real del stock disponible (comprado)
document.getElementById('inboundUnid')?.addEventListener('input', function() {
    const inputVal = parseInt(this.value.replace(/\./g, '')) || 0;
    const initial = parseFloat(document.getElementById('inboundAvailable').dataset.initial) || 0;
    const remaining = initial - inputVal;
    
    this.value = formatNumber(inputVal);
    document.getElementById('inboundAvailable').value = formatNumber(remaining);
});

document.getElementById('formInboundInventory')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const productName = document.getElementById('inboundProduct').value;
    const inboundUnid = parseInt(document.getElementById('inboundUnid').value.replace(/\./g, '')) || 0;
    const rawAmount = inboundUnid; // La cantidad total se iguala a las unidades ingresadas
    const farmName = document.getElementById('inboundFarm').value;
    const moveDate = document.getElementById('inboundDate').value;
    const providerName = document.getElementById('inboundProvider').value;
    const inboundMedit = document.getElementById('inboundUnit').value; // Medida
    const description = document.getElementById('inboundDescription').value;
    const shedValue = document.getElementById('inboundShed').value;

    // 1. Registro en tabla movements
    const { error: moveError } = await _supabase.from('movements').insert([{
        name: productName,
        type: "ingreso",
        amount: rawAmount,
        farm: farmName,
        medit: inboundMedit, // Guardar medida
        shed: shedValue || null, // Mantener shed si aplica
        // categorie: categoryName, // La categoría ya no se guarda en movimientos
        date_movement: moveDate,
        provider: providerName || "",
        description: description,
        created_at: getColombiaTimestamp()
    }]);

    if (moveError) {
        showToast("Error al registrar movimiento: " + moveError.message, "error");
        return;
    }

    // 2. Actualización de tabla inventory (Suma técnica de saldos)
    let invQuery = _supabase
        .from('inventory')
        .select('amount, provider')
        .eq('product', productName)
        .eq('medit', inboundMedit) // Filtrar por medida
        .eq('farm', farmName);
    
    // No longer filtering by shed for product inventory
    const { data: currentInv } = await invQuery.maybeSingle();

    const newTotal = (currentInv?.amount || 0) + rawAmount;
    
    // Gestión de Array de Proveedores en Inventario
    let providersArray = Array.isArray(currentInv?.provider) ? currentInv.provider : [];
    if (providerName && !providersArray.includes(providerName)) {
        providersArray.push(providerName);
    }

    let updateError;
    if (!currentInv) {
        // Ingeniería de Datos: Fallback de creación si el registro específico (Galpón) no se inicializó previamente
        const { data: pData } = await _supabase.from('products').select('code, unit').eq('name', productName).maybeSingle();
        const { error: insErr } = await _supabase.from('inventory').insert([{
            code: pData?.code || '',
            product: productName,
            // categorie: categoryName, // La categoría ya no se guarda en el inventario
            shed: shedValue || null,
            medit: inboundMedit,
            amount: newTotal,
            farm: farmName,
            provider: providersArray,
            created_at: getColombiaTimestamp()
        }]);
        updateError = insErr;
    } else {
        let updateQuery = _supabase
            .from('inventory')
            .update({ 
                amount: newTotal,
                medit: inboundMedit, // Actualizar medida
                provider: providersArray
            })
            .eq('product', productName)
            .eq('farm', farmName);

        if (shedValue) updateQuery = updateQuery.eq('shed', shedValue);
        const { error: updErr } = await updateQuery;
        updateError = updErr;
    }

    if (updateError) {
        showToast("Error al actualizar existencias: " + updateError.message, "error");
    } else {
        // Ingeniería de Backend: Actualización del stock global en la tabla 'products'
        const remainingStock = parseFloat(document.getElementById('inboundAvailable').value.replace(/\./g, ''));
        const { error: prodUpdateError } = await _supabase
            .from('products')
            .update({ unit: remainingStock })
            .eq('name', productName);

        if (prodUpdateError) console.error("Error al actualizar stock global:", prodUpdateError);

        showToast("Ingreso de inventario procesado correctamente");
        
        // Ingeniería de Interfaz: Limpieza total de los datos para el próximo registro
        e.target.reset();
        document.getElementById('inboundExtraFields').classList.add('hidden');
        document.getElementById('inboundShedInfo').classList.add('hidden');
        
        closeModals();
        document.getElementById('btnGestionInventario').click();
    }
});

// FASE 6.4: Ingeniería de Salidas de Inventario
async function prepareOutboundModal() {
    const prodSelect = document.getElementById('outboundProduct');
    const extraFields = document.getElementById('outboundExtraFields');
    extraFields.classList.add('hidden');
    
    // Carga de productos desde inventario (excluyendo categorías de animales)
    let { data: invItems } = await _supabase.from('inventory').select('product, medit').order('product'); // Items currently in inventory
    // Ya no se filtra por categorías de animales aquí, ya que los productos no tienen categoría

    const { data: productsInfo } = await _supabase.from('products').select('name, medit, unit, animal').order('name'); // All product info

    const meditMap = Object.fromEntries((productsInfo || []).map(p => [p.name, p.medit]));
    const unitMap = Object.fromEntries((productsInfo || []).map(p => [p.name, p.unit])); // Factor de conversión
    const animalSet = new Set((productsInfo || []).filter(p => p.animal).map(p => p.name));
    const uniqueInvNames = [...new Set((invItems || []).map(i => i.product))].filter(name => !animalSet.has(name));

    prodSelect.innerHTML = '<option value="" disabled selected hidden>Seleccione producto...</option>' + 
        uniqueInvNames.map(name => {
            return `<option value="${name}" data-unit="${unitMap[name] || ''}" data-medit="${meditMap[name] || ''}">${name}</option>`;
        }).join('');

    const { data: farms } = await _supabase.from('farms').select('name').order('name');
    const farmSelect = document.getElementById('outboundFarm');
    if (farmSelect) {
        farmSelect.innerHTML = '<option value="" disabled selected hidden>Seleccionar granja...</option>' + 
            farms.map(f => `<option value="${f.name}">${f.name}</option>`).join('');

        // Lógica de Bloqueo por Granja Asignada
        if (window.CURRENT_USER_FARM && window.CURRENT_USER_FARM !== 'Todas las granjas') {
            farmSelect.value = window.CURRENT_USER_FARM;
            farmSelect.disabled = true;
        } else {
            farmSelect.disabled = false;
        }
    }
}

document.getElementById('outboundProduct')?.addEventListener('change', function() {
    const selected = this.options[this.selectedIndex];
    if (!selected.value) return;
    const medit = selected.getAttribute('data-medit');
    document.getElementById('outboundFarm').value = ""; // Reset farm selection
    document.getElementById('outboundUnit').value = medit; // Display measure
    document.getElementById('outboundExtraFields').classList.remove('hidden'); // Show extra fields
    document.getElementById('outboundShedContainer').classList.add('hidden'); // Ocultar galpón para salida de productos
});

// Carga de galpones para el formulario de salida al seleccionar granja
document.getElementById('outboundFarm')?.addEventListener('change', async function() {
    const farmName = this.value;
    const prodSelect = document.getElementById('outboundProduct');
    const selected = prodSelect.options[prodSelect.selectedIndex];
    const shedSelect = document.getElementById('outboundShed');

    // No longer loading sheds for product outbound
});

// Ingeniería de Backend: Sincronización de capacidad de Galpones (Used)
async function updateShedUsage(farm, number, amount, isEntry) {
    const { data: shed } = await _supabase
        .from('sheds')
        .select('used')
        .eq('farm', farm)
        .eq('number', number)
        .maybeSingle();

    if (shed) {
        const newUsed = isEntry ? (shed.used + amount) : (shed.used - amount);
        await _supabase.from('sheds').update({ used: Math.max(0, newUsed) }).eq('farm', farm).eq('number', number);
    }
}

document.getElementById('formOutboundInventory')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const productName = document.getElementById('outboundProduct').value;
    const outboundUnid = parseInt(document.getElementById('outboundUnid').value.replace(/\./g, '')) || 0;
    const rawAmount = outboundUnid;
    const farmName = document.getElementById('outboundFarm').value;
    const moveDate = document.getElementById('outboundDate').value;
    const description = document.getElementById('outboundDescription').value;
    const outboundMedit = document.getElementById('outboundUnit').value; // Medida
    const shedValue = document.getElementById('outboundShed').value;

    // 1. Registro en tabla movements (tipo salida, proveedor vacío)
    const { error: moveError } = await _supabase.from('movements').insert([{
        name: productName,
        type: "salida",
        amount: rawAmount,
        farm: farmName,
        medit: outboundMedit, // Guardar medida
        shed: shedValue || null,
        // categorie: productSelect.options[productSelect.selectedIndex].getAttribute('data-cat') || '', // La categoría ya no se guarda en movimientos
        date_movement: moveDate,
        provider: "",
        description: description,
        created_at: getColombiaTimestamp()
    }]);

    if (moveError) {
        showToast("Error al registrar salida: " + moveError.message, "error");
        return;
    }

    // 2. Actualización de tabla inventory (Resta técnica de saldos)
    let invQuery = _supabase
        .from('inventory')
        .select('amount')
        .eq('product', productName)
        .eq('medit', outboundMedit) // Filtrar por medida
        .eq('farm', farmName);
    
    // No longer filtering by shed for product inventory
    const { data: currentInv } = await invQuery.maybeSingle();

    if (!currentInv) {
        showToast("Error: El producto no se encuentra en la granja seleccionada.", "error");
        return;
    }

    const newTotal = (currentInv.amount || 0) - rawAmount;

    let updateQuery = _supabase
        .from('inventory')
        .update({ amount: newTotal })
        .eq('medit', outboundMedit)
        .eq('product', productName)
        .eq('farm', farmName);

    // No longer updating by shed for product outbound
    const { error: updateError } = await updateQuery;

    if (updateError) {
        showToast("Error al actualizar existencias: " + updateError.message, "error");
    } else {
        showToast("Salida de inventario procesada correctamente");
        e.target.reset();
        document.getElementById('outboundExtraFields').classList.add('hidden');
        closeModals();
        document.getElementById('btnGestionInventario').click();
    }
});

// Lógica de Backend (Client-side): Inserción de Granjas Fase 4.1
document.getElementById('formCreateFarm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const isEdit = form.dataset.mode === 'edit';

    const farmData = {
        name: document.getElementById('farmName').value,
        address: document.getElementById('farmAddress').value,
        // Ingeniería de Datos: 'animals' ahora es un array de strings (tipos de animales)
        animals: document.getElementById('farmAnimals').value.split(',').map(item => item.trim()).filter(item => item !== ''),
        // Ingeniería de Datos: 'animals_capacity' ahora es un solo número (capacidad máxima total)
        animals_capacity: parseInt(document.getElementById('farmCapacity').value)
    };

    let result;
    if (isEdit) {
        result = await _supabase.from('farms').update(farmData).eq('name', form.dataset.originalId);
    } else {
        farmData.animals_in_farm = 0;
        farmData.created_at = getColombiaTimestamp();
        result = await _supabase.from('farms').insert([farmData]);
    }

    const { error } = result;

    if (error) {
        showToast("Error al crear granja: " + error.message, "error");
    } else {
        showToast(isEdit ? "Granja actualizada exitosamente" : "Granja creada exitosamente");
        closeModals();
        document.getElementById('btnGestionGranjas').click(); // Refresco de vista
    }
});

// FASE 4.1: Ingeniería de Backend y Frontend para Gestión de Granjas
document.getElementById('btnGestionGranjas').addEventListener('click', async () => {
    // Gestión de Interfaz: Conmutación de vistas
    document.getElementById('usersView').classList.add('hidden');
    document.getElementById('suppliersView')?.classList.add('hidden');
    document.getElementById('productsView')?.classList.add('hidden');
    document.getElementById('inventoryView')?.classList.add('hidden');
    const farmsView = document.getElementById('farmsView');
    farmsView.classList.remove('hidden');
    
    const tableContainer = document.getElementById('farmsTableContainer');
    tableContainer.innerHTML = "<p style='padding:20px;'>Cargando datos de granjas...</p>";

    // Consulta a la tabla 'farms' incluyendo la nueva columna animals_in_farm
    const { data, error } = await _supabase
        .from('farms')
        .select('name, address, animals, animals_capacity, animals_in_farm');

    if (error) {
        console.error("Error al obtener datos de granjas:", error);
        tableContainer.innerHTML = `<p class="error-msg">Error: ${error.message}</p>`;
        return;
    }

    renderFarmsTable(data);
});

function renderFarmsTable(farms) {
    const tableContainer = document.getElementById('farmsTableContainer');
    
    let html = `
        <table>
            <thead>
                <tr>
                    <th>Nombre</th>
                    <th>Dirección</th>
                    <th>Animales</th>
                    <th>Capacidad</th>
                    <th>Capacidad ocupada</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${farms.map(f => `
                    <tr>
                        <td>${f.name || 'Sin nombre'}</td>
                        <td>${f.address || 'N/A'}</td>
                        <td>${Array.isArray(f.animals) ? f.animals.join(', ') : (f.animals || 'N/A')}</td>
                        <td>${formatNumber(f.animals_capacity)}</td>
                        <td>${formatNumber(f.animals_in_farm)}</td>
                        <td>
                            <div style="display:flex; gap:5px;">
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #0984e3;" onclick="editFarm('${f.name}')">Editar</button>
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #d63031;" onclick="deleteFarm('${f.name}')">Borrar</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    
    tableContainer.innerHTML = html;
}

// FASE 5.1: Ingeniería de Backend y Frontend para Gestión de Proveedores
async function loadProductsForSelect() {
    // Carga dinámica desde la tabla 'products' columna 'name'
    const { data, error } = await _supabase.from('products').select('name');
    const select = document.getElementById('supProducts');
    if (error) {
        console.error("Error al cargar productos:", error);
        return;
    }
    select.innerHTML = data?.map(p => `<option value="${p.name}">${p.name}</option>`).join('') || '<option value="">Sin productos disponibles</option>';
}

document.getElementById('btnGestionProveedores')?.addEventListener('click', async () => {
    document.getElementById('welcomeMessage')?.classList.add('hidden');
    // Gestión de Interfaz: Conmutación de vistas
    document.getElementById('usersView').classList.add('hidden');
    document.getElementById('farmsView').classList.add('hidden');
    document.getElementById('productsView')?.classList.add('hidden');
    document.getElementById('inventoryView')?.classList.add('hidden');
    const suppliersView = document.getElementById('suppliersView');
    suppliersView.classList.remove('hidden');
    
    const tableContainer = document.getElementById('suppliersTableContainer');
    tableContainer.innerHTML = "<p style='padding:20px;'>Cargando proveedores...</p>";

    const { data, error } = await _supabase
        .from('providers')
        .select('name, nit, product');

    if (error) {
        console.error("Error al obtener proveedores:", error);
        tableContainer.innerHTML = `<p class="error-msg">Error: ${error.message}</p>`;
        return;
    }

    renderSuppliersTable(data);
});

function renderSuppliersTable(providers) {
    const tableContainer = document.getElementById('suppliersTableContainer');
    let html = `
        <table>
            <thead>
                <tr>
                    <th>Nombre</th>
                    <th>Nit</th>
                    <th>Productos</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${providers.length === 0 ? '<tr><td colspan="4" style="text-align:center;">No hay datos para mostrar en este momento</td></tr>' : providers.map(p => `
                    <tr>
                        <td>${p.name || 'Sin nombre'}</td>
                        <td>${p.nit || 'N/A'}</td>
                        <td>${Array.isArray(p.product) ? p.product.join(', ') : (p.product || 'N/A')}</td>
                        <td>
                            <div style="display:flex; gap:5px;">
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #0984e3;" onclick="editSupplier('${p.nit}')">Editar</button>
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #d63031;" onclick="deleteSupplier('${p.nit}')">Borrar</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    tableContainer.innerHTML = html;
}

document.getElementById('formCreateSupplier')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const isEdit = form.dataset.mode === 'edit';
    const selectedProducts = Array.from(document.getElementById('supProducts').selectedOptions).map(opt => opt.value);

    const supplierData = {
        name: document.getElementById('supName').value,
        nit: document.getElementById('supNit').value,
        product: selectedProducts
    };

    let result;
    if (isEdit) {
        result = await _supabase.from('providers').update(supplierData).eq('nit', form.dataset.originalId);
    } else {
        supplierData.created_at = getColombiaTimestamp();
        result = await _supabase.from('providers').insert([supplierData]);
    }

    const { error } = result;

    if (error) showToast("Error al registrar proveedor: " + error.message, "error");
    else { 
        showToast(isEdit ? "Proveedor actualizado" : "Proveedor registrado exitosamente"); 
        closeModals(); 
        document.getElementById('btnGestionProveedores').click(); 
    }
});

document.getElementById('btnGestionProductos')?.addEventListener('click', async () => {
    document.getElementById('welcomeMessage')?.classList.add('hidden');
    document.getElementById('usersView').classList.add('hidden');
    document.getElementById('farmsView').classList.add('hidden');
    document.getElementById('suppliersView').classList.add('hidden');
    document.getElementById('inventoryView')?.classList.add('hidden');
    const productsView = document.getElementById('productsView');
    productsView.classList.remove('hidden');
    
    const tableContainer = document.getElementById('productsTableContainer');
    tableContainer.innerHTML = "<p style='padding:40px; text-align:center; color:#636e72;'>Realice una búsqueda o seleccione una categoría para ver los productos</p>";

    const searchInput = document.getElementById('searchProductInput');
    if (searchInput) {
        searchInput.value = "";
        searchInput.oninput = () => loadFilteredProducts();
    }
});

function renderProductsTable(products) {
    const tableContainer = document.getElementById('productsTableContainer');
    let html = `
        <table>
            <thead>
                    <th>Código</th>
                    <th>Nombre</th>
                    <th>Unidad</th>
                    <th>Medida</th>
                    <th>Precio Compra</th>
                    <th>Precio Venta</th>
                    <th>Precio Final de Compra</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${products.length === 0 ? '<tr><td colspan="8" style="text-align:center;">No hay datos para mostrar en este momento</td></tr>' : products.map(p => `
                    <tr>
                        <td>${p.code || 'N/A'}</td>
                        <td>${p.name || 'Sin nombre'}</td>
                        <td>${formatNumber(p.unit)}</td>
                        <td>${p.medit || 'N/A'}</td>
                        <td>$ ${formatNumber(p.buy_price)}</td>
                        <td>$ ${formatNumber(p.sale_price)}</td>
                        <td>$ ${formatNumber(p.total)}</td>
                        <td>
                            <div style="display:flex; gap:5px;">
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #0984e3;" onclick="editProduct('${p.code}')">Editar</button>
                                ${p.animal ? `<button class="action-btn" style="margin:0; padding:5px 10px; background: #6c5ce7;" onclick="openConfigAnimalFields('${p.name}')">Configurar</button>` : ''}
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #d63031;" onclick="deleteProduct('${p.code}')">Borrar</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    tableContainer.innerHTML = html;
}

document.getElementById('formCreateProduct')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const isEdit = form.dataset.mode === 'edit';
    const unit = parseFloat(document.getElementById('prodUnit').value) || 0;
    const buyPrice = parseInt(document.getElementById('prodBuyPrice').value.replace(/\./g, '')) || 0;
    const hasWeight = document.getElementById('prodHasWeight')?.checked;
    const isAnimal = document.getElementById('prodIsAnimal')?.checked || false;

    const productData = {
        code: document.getElementById('prodCode').value,
        name: document.getElementById('prodName').value,
        unit: unit,
        medit: document.getElementById('prodMedit').value,
        buy_price: buyPrice,
        sale_price: parseInt(document.getElementById('prodSalePrice').value.replace(/\./g, '')) || 0,
        total: unit * buyPrice,
        weigth: hasWeight ? (parseFloat(document.getElementById('prodWeight').value) || 0) : null,
        animal: isAnimal
    };

    let result;
    if (isEdit) {
        result = await _supabase.from('products').update(productData).eq('code', form.dataset.originalId);
    } else {
        productData.created_at = getColombiaTimestamp();
        result = await _supabase.from('products').insert([productData]);
    }

    const { error } = result;
    if (error) showToast("Error al agregar producto: " + error.message, "error");
    else { 
        showToast(isEdit ? "Producto actualizado" : "Producto agregado exitosamente"); 
        closeModals(); 
        document.getElementById('btnGestionProductos').click(); 
    }
});

async function loadFilteredInventory(mode) {
    const search = normalizeText(document.getElementById('searchInventoryInput')?.value);
    const farm = document.getElementById('filterInventoryFarm')?.value;
    const category = document.getElementById('filterInventoryCategory')?.value;
    const animal = document.getElementById('filterInventoryAnimal')?.value;
    const shed = document.getElementById('filterInventoryShed')?.value;
    const date = document.getElementById('filterInventoryDate')?.value;
    const tableContainer = document.getElementById('inventoryTableContainer'); // Moved up for early exit

    if (mode === 'sheds') { // This block remains for sheds
        if (!farm && !shed && !animal) { // If no filters, show placeholder
            tableContainer.innerHTML = "<p style='padding:40px; text-align:center; color:#636e72;'>Seleccione un filtro para visualizar los galpones</p>"; // Corrected message
            return; // Exit early
        }
        let query = _supabase.from('sheds').select('*');
        if (farm && farm !== 'all') query = query.eq('farm', farm);
        if (shed && shed !== 'all') query = query.eq('number', shed);
        if (animal && animal !== 'all') query = query.eq('animal', animal);
        const { data, error } = await query;
        if (error) return tableContainer.innerHTML = `<p class="error-msg">Error: ${error.message}</p>`;
        renderShedsTable(data);
        return;
    }

    // For 'products' mode, initial empty state until interaction
    if (!search && !farm && !category && !animal && !shed && !date) {
        tableContainer.innerHTML = "<p style='padding:40px; text-align:center; color:#636e72;'>Realice una búsqueda o seleccione un filtro para visualizar los datos</p>";
        return;
    }

    tableContainer.innerHTML = "<p style='padding:20px;'>Cargando inventario...</p>";

    let query = _supabase.from('inventory').select('*');
    if (farm && farm !== 'all') query = query.eq('farm', farm);
    // Removed shed filter for product inventory
    if (date) query = query.gte('created_at', `${date}T00:00:00`).lte('created_at', `${date}T23:59:59`);

    const { data, error } = await query;
    if (error) {
        tableContainer.innerHTML = `<p class="error-msg">Error: ${error.message}</p>`;
        return;
    }

    let filtered = data || [];
    // No mostrar productos animales en el inventario de productos
    const { data: animalProducts } = await _supabase.from('products').select('name').eq('animal', true);
    const animalNames = new Set((animalProducts || []).map(p => p.name));
    filtered = filtered.filter(item => !animalNames.has(item.product));

    if (category && category !== 'all') { // Category filter only for products
        filtered = filtered.filter(item => item.categorie === category);
    }

    if (search) {
        filtered = filtered.filter(item => 
            normalizeText(item.product).includes(search) || 
            normalizeText(item.code).includes(search)
        );
    }

    renderInventoryTable(filtered, mode);
}

// FASE 6.1: Ingeniería de Backend y Frontend para Gestión de Inventario
document.getElementById('btnGestionInventario')?.addEventListener('click', () => {
    document.getElementById('welcomeMessage')?.classList.add('hidden');
    renderInventoryView('products');
});

async function renderInventoryView(mode) {
    window.CURRENT_INVENTORY_MODE = mode;
    // Gestión de Interfaz: Conmutación de vistas
    document.getElementById('usersView').classList.add('hidden');
    document.getElementById('farmsView').classList.add('hidden');
    document.getElementById('suppliersView').classList.add('hidden');
    document.getElementById('productsView').classList.add('hidden');
    const inventoryView = document.getElementById('inventoryView');
    inventoryView.classList.remove('hidden');

    // Actualización dinámica del título según el modo
    const titleHeader = inventoryView.querySelector('h3');
    if (mode === 'products') titleHeader.textContent = "Inventario de Productos";
    else if (mode === 'sheds') titleHeader.textContent = "Galpones"; // Only two modes now
    
    const tableContainer = document.getElementById('inventoryTableContainer');
    const filterBar = document.getElementById('inventoryFilterBar');
    const btnInbound = document.getElementById('btnInventoryInbound');
    const btnOutbound = document.getElementById('btnInventoryOutbound');
    const btnShed = document.getElementById('btnInventoryShed');

    // FASE 11.3: Configuración dinámica de la barra de acciones y filtros
    filterBar?.classList.remove('hidden');
    
    // Ocultar todos los botones de acción primero
    btnInbound?.classList.add('hidden');
    btnOutbound?.classList.add('hidden');
    btnShed?.classList.add('hidden');

    if (mode === 'sheds') {
        btnShed?.classList.remove('hidden');
    } else { // Modo 'products' por defecto
        btnInbound?.classList.remove('hidden');
        btnOutbound?.classList.remove('hidden');
        btnInbound.textContent = "Ingresar producto";
        btnOutbound.textContent = "Sacar producto";
    }

    const searchInput = document.getElementById('searchInventoryInput');
    const farmSelect = document.getElementById('filterInventoryFarm');
    const catSelect = document.getElementById('filterInventoryCategory');
    const animalSelect = document.getElementById('filterInventoryAnimal');
    const shedSelect = document.getElementById('filterInventoryShed');
    const dateInput = document.getElementById('filterInventoryDate');

    // Limpieza de campos al entrar
    [searchInput, farmSelect, catSelect, animalSelect, shedSelect, dateInput].forEach(el => { if(el) el.value = ""; });

    if (mode === 'sheds') { // Only for sheds
        catSelect?.classList.add('hidden');
        animalSelect?.classList.remove('hidden');
        shedSelect?.classList.remove('hidden');
        searchInput?.classList.add('hidden');
        dateInput?.classList.add('hidden');
    } else { // For products
        searchInput?.classList.remove('hidden');
        dateInput?.classList.remove('hidden');
        catSelect?.classList.remove('hidden');
        animalSelect?.classList.add('hidden');
        shedSelect?.classList.add('hidden'); // Shed select is only for sheds view
    }

    // Poblar Granja
    const { data: farms } = await _supabase.from('farms').select('name').order('name');
    if (farmSelect) {
        farmSelect.innerHTML = '<option value="" disabled selected hidden>Filtrar por granja...</option><option value="all">Todas</option>' +
            (farms?.map(f => `<option value="${f.name}">${f.name}</option>`).join('') || '');
    }

    // Poblar Categoría (Productos)
    // El filtro de categoría se elimina de la vista de inventario ya que los productos ya no tienen categorías
    catSelect?.classList.add('hidden'); // Asegurarse de que el filtro de categoría esté oculto

    // Poblar Animales (Productos cuya categoría coincida con animal/animales) - only for sheds view
    // Ahora se obtienen los animales de la configuración de las granjas, no de categorías de productos
    if (mode === 'sheds' && animalSelect) {
        const { data: allFarms } = await _supabase.from('farms').select('animals');
        const uniqueAnimalNames = new Set();
        allFarms?.forEach(farm => {
            if (Array.isArray(farm.animals)) {
                farm.animals.forEach(animal => uniqueAnimalNames.add(animal));
            }
        });
        const animalsForFilter = Array.from(uniqueAnimalNames);
        animalSelect.innerHTML = `<option value="" disabled selected hidden>Filtrar por ${mode === 'sheds' ? 'animal del galpón' : 'animal'}...</option><option value="all">Ver todos</option>` +
            animalsForFilter.map(a => `<option value="${a}">${a}</option>`).join('');
    }

    // Poblar Galpones
    if ((mode === 'animals' || mode === 'sheds') && shedSelect) {
        const { data: sheds } = await _supabase.from('sheds').select('number').order('number');
        const uniqueSheds = [...new Set(sheds?.map(s => s.number))] || [];
        shedSelect.innerHTML = '<option value="" disabled selected hidden>Filtrar por galpón...</option><option value="all">Ver todos los galpones</option>' +
            uniqueSheds.map(s => `<option value="${s}">${s}</option>`).join('');
    }

    const runFilter = () => loadFilteredInventory(mode);
    [searchInput, farmSelect, catSelect, animalSelect, shedSelect, dateInput].forEach(el => {
        if (el) {
            el.onchange = runFilter;
            if (el.id === 'searchInventoryInput') el.oninput = runFilter;
        }
    });

    tableContainer.innerHTML = `<p style='padding:40px; text-align:center; color:#636e72;'>${mode === 'sheds' ? 'Seleccione un filtro para visualizar los galpones' : 'Realice una búsqueda o seleccione un filtro para visualizar los datos'}</p>`;
}

function renderShedsTable(data) {
    const tableContainer = document.getElementById('inventoryTableContainer');
    tableContainer.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Número</th>
                    <th>Granja</th>
                    <th>Capacidad</th>
                    <th>Ocupado</th>
                    <th>Animal</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${data.length === 0 ? '<tr><td colspan="6" style="text-align:center;">No hay datos para mostrar con los filtros seleccionados</td></tr>' : data.map(s => `
                    <tr>
                        <td>${s.number}</td>
                        <td>${s.farm}</td>
                        <td>${formatNumber(s.ability)}</td>
                        <td>${formatNumber(s.used)}</td>
                        <td>${s.animal || 'N/A'}</td>
                        <td>
                            <div style="display:flex; gap:5px;">
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #0984e3;" onclick="editShed('${s.farm}', ${s.number})">Editar</button>
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #d63031;" onclick="deleteShed('${s.farm}', ${s.number})">Borrar</button>
                                <!-- Nuevo botón para gestionar animales -->
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #6c5ce7;" onclick="manageShedAnimals('${s.farm}', ${s.number})">Animales</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
}

function renderInventoryTable(items) { // Removed mode parameter as it's always 'products' now
    const tableContainer = document.getElementById('inventoryTableContainer');
    // Shed column is no longer shown in product inventory
    let html = `
        <table>
            <thead>
                <tr>
                    <th>Código</th>
                    <th>Nombre</th>
                    <th>Granja</th>
                    <th>Medida</th> 
                    <th>Cantidad</th>
                    <th>Proveedor</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${items.length === 0 ? `<tr><td colspan="6" style="text-align:center;">No hay datos para mostrar en este momento</td></tr>` : items.map(item => `
                    <tr>
                        <td>${item.code || 'N/A'}</td>
                        <td>${item.product || 'Sin nombre'}</td>
                        <td>${item.farm || 'N/A'}</td>
                        <td>${item.medit || 'N/A'}</td>
                        <td>${formatInventoryAmount(item.amount)}</td>
                        <td>${Array.isArray(item.provider) ? item.provider.join(', ') : (item.provider || 'N/A')}</td>
                        <td>
                            <div style="display:flex; gap:5px;">
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #0984e3;" onclick="editInventoryItem('${item.id || item.product}')">Editar</button>
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #d63031;" onclick="deleteInventoryItem('${item.id || item.product}')">Borrar</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    
    tableContainer.innerHTML = html;
}

document.getElementById('btnGestionGranjas')?.addEventListener('click', () => {

// Ingeniería de Sistemas: Restricción para que campos de identificación solo reciban números
['newCedula', 'updCedula', 'supNit'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', function() {
        this.value = this.value.replace(/[^0-9]/g, '');
    });
});

// Formateo de entrada numérica en tiempo real para Unidades
const setupAutoCalc = (unidId, amountId, selectId) => {
    const unidInput = document.getElementById(unidId);
    const amountInput = document.getElementById(amountId);
    const prodSelect = document.getElementById(selectId);

    if (!unidInput || !amountInput || !prodSelect) return;

    unidInput.addEventListener('input', function() {
        const selected = prodSelect.options[prodSelect.selectedIndex];
        const factor = parseFloat(selected?.getAttribute('data-unit')) || 0;
        const units = parseInt(this.value.replace(/\./g, '')) || 0;
        
        this.value = formatNumber(units);
        if (factor > 0) {
            amountInput.value = formatNumber(units * factor);
        }
    });

    amountInput.addEventListener('input', function() {
        const selected = prodSelect.options[prodSelect.selectedIndex];
        const factor = parseFloat(selected?.getAttribute('data-unit')) || 0;
        const amount = parseInt(this.value.replace(/\./g, '')) || 0;

        this.value = formatNumber(amount);
        if (factor > 0) {
            unidInput.value = formatNumber(Math.floor(amount / factor));
        }
    });
};

// Formateo de precios en el registro de productos
['prodBuyPrice', 'prodSalePrice'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', function(e) {
        let val = e.target.value.replace(/\D/g, '');
        e.target.value = formatNumber(val);
        if (id === 'prodBuyPrice') updateProductTotalProjection();
    });
});
document.getElementById('prodUnit')?.addEventListener('input', updateProductTotalProjection);

    document.getElementById('welcomeMessage')?.classList.add('hidden');
});

/**
 * Ingeniería de Sistemas: Renderizado dinámico de la lista de categorías
 * Muestra los códigos y nombres existentes en la tabla 'categories'.
 */
async function renderCategoriesList() {
    const container = document.getElementById('categoriesListContainer');
    container.innerHTML = "<p style='padding:20px; text-align:center;'>Cargando categorías...</p>";

    const { data, error } = await _supabase
        .from('categories')
        .select('code, name')
        .order('code', { ascending: true });

    if (error) {
        showToast("Error al cargar categorías: " + error.message, "error");
        container.innerHTML = `<p style="padding:20px; text-align:center; color: #d63031;">Error al cargar datos</p>`;
        return;
    }

    let html = `
        <table>
            <thead>
                <tr>
                    <th>Código</th>
                    <th>Nombre</th>
                </tr>
            </thead>
            <tbody>
                ${(!data || data.length === 0) 
                    ? '<tr><td colspan="2" style="text-align:center; padding: 20px;">No hay datos para mostrar en este momento</td></tr>' 
                    : data.map(c => `
                        <tr>
                            <td>${c.code}</td>
                            <td>${c.name}</td>
                        </tr>
                    `).join('')}
            </tbody>
        </table>`;
    
    container.innerHTML = html;
}

/**
 * Ingeniería de Sistemas: Controladores Globales para Acciones de Tabla (FASE 11.4)
 * Estas funciones resuelven los ReferenceError al ser invocadas desde el DOM.
 */

window.editFarm = async (name) => {
    const { data, error } = await _supabase.from('farms').select('*').eq('name', name).single();
    if (error || !data) return showToast("Error al cargar datos de la granja", "error");

    const form = document.getElementById('formCreateFarm');
    form.dataset.mode = 'edit';
    form.dataset.originalId = name;
    showModal('modalCreateFarm');
    document.querySelector('#modalCreateFarm h4').textContent = "Editar Granja";
    document.querySelector('#formCreateFarm button[type="submit"]').textContent = "Actualizar Granja";

    document.getElementById('farmName').value = data.name;
    document.getElementById('farmAddress').value = data.address;
    document.getElementById('farmAnimals').value = Array.isArray(data.animals) ? data.animals.join(', ') : '';
    document.getElementById('farmCapacity').value = data.animals_capacity;
};

window.deleteFarm = async (name) => {
    if (!confirm(`¿Está seguro de eliminar la granja "${name}"? Esta acción no se puede deshacer.`)) return;
    const { error } = await _supabase.from('farms').delete().eq('name', name);
    if (error) showToast("Error: " + error.message, "error");
    else { showToast("Granja eliminada"); document.getElementById('btnGestionGranjas').click(); }
};

window.editSupplier = async (nit) => {
    const { data, error } = await _supabase.from('providers').select('*').eq('nit', nit).single();
    if (error || !data) return showToast("Error al cargar datos del proveedor", "error");

    await loadProductsForSelect();
    const form = document.getElementById('formCreateSupplier');
    form.dataset.mode = 'edit';
    form.dataset.originalId = nit;
    showModal('modalCreateSupplier');
    document.querySelector('#modalCreateSupplier h4').textContent = "Editar Proveedor";
    document.querySelector('#formCreateSupplier button[type="submit"]').textContent = "Actualizar Proveedor";

    document.getElementById('supName').value = data.name;
    document.getElementById('supNit').value = data.nit;
    const select = document.getElementById('supProducts');
    const products = Array.isArray(data.product) ? data.product : [];
    Array.from(select.options).forEach(opt => opt.selected = products.includes(opt.value));
};

window.deleteSupplier = async (nit) => {
    if (!confirm(`¿Está seguro de eliminar al proveedor con NIT ${nit}?`)) return;
    const { error } = await _supabase.from('providers').delete().eq('nit', nit);
    if (error) showToast("Error: " + error.message, "error");
    else { showToast("Proveedor eliminado"); document.getElementById('btnGestionProveedores').click(); }
};

window.editProduct = async (code) => {
    const { data, error } = await _supabase.from('products').select('*').eq('code', code).single();
    if (error || !data) return showToast("Error al cargar datos del producto", "error");

    const form = document.getElementById('formCreateProduct');
    form.dataset.mode = 'edit';
    form.dataset.originalId = code;
    showModal('modalCreateProduct');
    document.querySelector('#modalCreateProduct h4').textContent = "Editar Producto";
    document.querySelector('#formCreateProduct button[type="submit"]').textContent = "Actualizar Producto";

    document.getElementById('prodName').value = data.name;
    document.getElementById('prodMedit').value = data.medit;
    document.getElementById('prodUnit').value = data.unit;
    document.getElementById('prodBuyPrice').value = formatNumber(data.buy_price);
    document.getElementById('prodSalePrice').value = formatNumber(data.sale_price);

    // Poblar campos de peso
    const hasWeight = data.weigth !== null && data.weigth !== undefined;
    const checkWeight = document.getElementById('prodHasWeight');
    if (checkWeight) {
        checkWeight.checked = hasWeight;
        document.getElementById('prodWeightContainer').classList.toggle('hidden', !hasWeight);
        document.getElementById('prodWeight').value = hasWeight ? data.weigth : "";
    }

    const isAnimalCheck = document.getElementById('prodIsAnimal');
    if (isAnimalCheck) {
        isAnimalCheck.checked = data.animal || false;
    }

    document.getElementById('prodCode').value = data.code; // Mover aquí para que se establezca después de resetear el modal
    updateProductTotalProjection();
};

window.deleteProduct = async (code) => {
    if (!confirm(`¿Está seguro de eliminar el producto con código ${code}?`)) return;
    const { error } = await _supabase.from('products').delete().eq('code', code);
    if (error) showToast("Error: " + error.message, "error");
    else { 
        showToast("Producto eliminado"); 
        loadFilteredProducts(); // Refrescar la búsqueda actual
    }
};

window.editShed = async (farm, number) => {
    const { data, error } = await _supabase.from('sheds').select('*').eq('farm', farm).eq('number', number).single();
    if (error || !data) return showToast("Error al cargar datos del galpón", "error");

    await prepareShedModal();
    const form = document.getElementById('formCreateShed');
    form.dataset.mode = 'edit';
    form.dataset.originalId = `${farm}-${number}`; // Identificador compuesto
    showModal('modalCreateShed');
    document.querySelector('#modalCreateShed h4').textContent = "Editar Galpón";
    document.querySelector('#formCreateShed button[type="submit"]').textContent = "Actualizar Galpón";

    const fSelect = document.getElementById('shedFarm');
    fSelect.value = data.farm;
    fSelect.disabled = true; // No permitir cambiar granja en edición

    await loadAnimalsForShed(data.farm);
    document.getElementById('shedNumber').value = data.number;
    document.getElementById('shedAnimal').value = data.animal;
    document.getElementById('shedAbility').value = data.ability;
};

window.deleteShed = async (farm, number) => {
    if (!confirm(`¿Está seguro de eliminar el galpón ${number} de la granja ${farm}?`)) return;
    const { error } = await _supabase.from('sheds').delete().eq('farm', farm).eq('number', number);
    if (error) showToast("Error: " + error.message, "error");
    else { 
        showToast("Galpón eliminado"); 
        loadFilteredInventory('sheds'); 
    }
};

// Nueva función para gestionar animales en un galpón específico
window.manageShedAnimals = async (farm, number) => {
    const modal = document.getElementById('modalManageShedAnimals');
    const title = document.getElementById('manageShedAnimalsTitle');

    // Almacenar la información del galpón en el dataset del modal para uso futuro
    modal.dataset.farm = farm;
    modal.dataset.number = number;
    title.textContent = `Gestión de Animales para Galpón ${number} de Granja ${farm}`;

    // Inicializar las tablas de entrada y salida con placeholders
    const inboundTableBody = document.getElementById('shedAnimalInboundTableBody');
    const outboundTableBody = document.getElementById('shedAnimalOutboundTableBody');

    inboundTableBody.innerHTML = '<div style="text-align:center; padding: 15px; color: #b2bec3;">Cargando registros...</div>';
    outboundTableBody.innerHTML = '<div style="text-align:center; padding: 15px; color: #b2bec3;">Cargando registros...</div>';

    await renderShedAnimalRecords(farm, number);

    // Mostrar el modal
    showModal('modalManageShedAnimals');
};

async function renderShedAnimalRecords(farm, number) {
    const inboundBody = document.getElementById('shedAnimalInboundTableBody');
    const outboundBody = document.getElementById('shedAnimalOutboundTableBody');

    const { data: batches, error: batchError } = await _supabase
        .from('animal_batches')
        .select('id, animal_name, created_at')
        .eq('farm_name', farm)
        .eq('shed_number', number)
        .order('created_at', { ascending: false });

    if (batchError) {
        inboundBody.innerHTML = '<div style="text-align:center; padding: 15px; color: #d63031;">Error cargando lotes</div>';
        outboundBody.innerHTML = '<div style="text-align:center; padding: 15px; color: #d63031;">Error cargando lotes</div>';
        return showToast("Error cargando lotes de animales", "error");
    }

    const batchMap = (batches || []).reduce((map, batch) => {
        map[batch.id] = batch.animal_name;
        return map;
    }, {});

    const batchIds = (batches || []).map(batch => batch.id);
    if (batchIds.length === 0) {
        inboundBody.innerHTML = '<div style="text-align:center; padding: 15px; color: #b2bec3;">No hay entradas registradas</div>';
        outboundBody.innerHTML = '<div style="text-align:center; padding: 15px; color: #b2bec3;">No hay salidas registradas</div>';
        return;
    }

    const { data: records, error: recordsError } = await _supabase
        .from('animal_production_records')
        .select('id, batch_id, event_type, units, initial_weight, dynamic_data, created_at')
        .in('batch_id', batchIds)
        .order('created_at', { ascending: true });

    if (recordsError) {
        inboundBody.innerHTML = '<div style="text-align:center; padding: 15px; color: #d63031;">Error cargando registros</div>';
        outboundBody.innerHTML = '<div style="text-align:center; padding: 15px; color: #d63031;">Error cargando registros</div>';
        return showToast("Error cargando movimientos de animales", "error");
    }

    // Build animal list (no selector): show most recent animal for this shed
    const animalOptions = Array.from(new Set((batches || []).map(b => b.animal_name))).sort();
    const label = document.getElementById('shedAnimalLabel');
    const defaultAnimal = batches.length > 0 ? batches[0].animal_name : '';
    if (label) {
        label.textContent = defaultAnimal ? `${defaultAnimal}` : 'Animal: --';
    }

    // Use the most recent animal as selected (no manual filtering)
    const selectedAnimal = defaultAnimal || null;
    const recs = (records || []).filter(r => {
        if (!selectedAnimal) return true;
        const name = batchMap[r.batch_id];
        return name === selectedAnimal;
    });

    const inbound = recs.filter(record => record.event_type === 'ingreso');
    const outbound = recs.filter(record => record.event_type === 'salida');

    const buildGroupedHtml = (list) => {
        if (!list || list.length === 0) return '<div style="padding:15px; text-align:center; color:#b2bec3;">No hay registros</div>';

        // Fetch config for animal (use first record's batch animal)
        const animalName = batchMap[list[0].batch_id];
        // get config mapping synchronously by querying supabase (already async context)
        // We'll fetch configs for this animal
        return (async () => {
            // If a filter is not selected, fetch configs for all animals in this shed
            const { data: configs } = await _supabase.from('animal_config').select('*').in('animal_name', animalOptions.length ? animalOptions : [animalName]);
            const opMap = {};
            (configs || []).forEach(c => { if (!opMap[c.field_label]) opMap[c.field_label] = { op: c.operation, display: c.display_format || 'number' }; });

            // Initialize groups
            const groups = {
                'Suma': {},
                'Resta': {},
                'Base ± Total': {},
                'Sumatoria': {},
                'División/Porcentaje': {},
                'Otros': {}
            };

            let totalUnits = 0;
            let totalWeight = 0;

            list.forEach(rec => {
                totalUnits += rec.units || 0;
                totalWeight += rec.initial_weight || 0;
                const dyn = rec.dynamic_data || {};
                Object.keys(dyn).forEach(k => {
                    const val = dyn[k];
                    const cfg = opMap[k];
                    let group = 'Otros';
                    if (cfg) {
                        const op = cfg.op;
                        if (op === 'sum') group = 'Suma';
                        else if (op === 'sub') group = 'Resta';
                        else if (op === 'formula_sum') group = 'Sumatoria';
                        else if (op === 'formula_diff' || op === 'formula_add') group = 'Base ± Total';
                        else if (op === 'formula_div') group = 'División/Porcentaje';
                    }
                    // Initialize
                    if (groups[group][k] === undefined) groups[group][k] = { sum: 0, count: 0, display: (opMap[k]?.display || 'number') };
                    groups[group][k].sum += parseFloat(val) || 0;
                    groups[group][k].count += 1;
                });
            });

            // Build HTML: header with totalWeight and totalUnits, then grouped rows
            let html = `<div style="padding:10px; display:flex; gap:20px; justify-content:center; font-weight:bold; color:#2d3436;"><div>Peso Inicial: ${formatNumber(totalWeight)}</div><div>Unidades: ${formatNumber(totalUnits)}</div></div>`;
            
            // Reorganize groups: keep Base ± Total in one row, combine Sumatoria + División/Porcentaje in another
            const rowOrder = ['Suma', 'Resta', 'Base ± Total', ['Sumatoria', 'División/Porcentaje'], 'Otros'];
            
            rowOrder.forEach(row => {
                let combinedItems = {};
                
                if (Array.isArray(row)) {
                    // Merge multiple groups into one row
                    row.forEach(groupName => {
                        if (groups[groupName]) {
                            Object.assign(combinedItems, groups[groupName]);
                        }
                    });
                } else {
                    // Single group row
                    if (groups[row]) {
                        combinedItems = groups[row];
                    }
                }
                
                const labels = Object.keys(combinedItems);
                if (labels.length === 0) return;

                html += `<div style="padding:0; margin:0;">`;
                html += `<table style="width:100%; border-collapse: collapse; margin:0; border:1px solid #bdbdbd;">`;
                // header row with field labels
                html += `<thead><tr style="background:#f8f9fa;">
                    ${labels.map(l => `<th style="text-align:center; padding:6px; font-size:13px; color:#636e72; border:1px solid #bdbdbd; font-weight:700;">${l}</th>`).join('')}
                </tr></thead>`;
                // single data row
                html += `<tbody><tr>`;
                labels.forEach(label => {
                    const it = combinedItems[label];
                    let cellVal = it.display === 'percent' ? (it.sum / it.count * 100).toFixed(2) + '%' : it.sum.toFixed(2);
                    html += `<td style="padding:6px; color:#2d3436; border:1px solid #bdbdbd; text-align:center;">${cellVal}</td>`;
                });
                html += `</tr></tbody>`;
                html += `</table>`;
                html += `</div>`;
            });
            return html;
        })();
    };

    // Render inbound and outbound by awaiting buildGroupedHtml
    const inboundHtml = await buildGroupedHtml(inbound);
    const outboundHtml = await buildGroupedHtml(outbound);

    inboundBody.innerHTML = `<div style="padding:10px;">${inboundHtml}</div>`;
    outboundBody.innerHTML = `<div style="padding:10px;">${outboundHtml}</div>`;
}

// --- Gestión Dinámica de Producción ---

window.openConfigAnimalFields = async (animalName) => {
    selectedFormulaFields = []; // Limpiar selección previa para evitar errores en nuevas configuraciones
    const modal = document.getElementById('modalConfigAnimalFields');
    modal.dataset.animal = animalName;
    modal.dataset.tab = 'ingreso'; // Pestaña por defecto
    document.getElementById('configAnimalTitle').textContent = `Producción: ${animalName}`;
    await renderAnimalConfigList();
    showModal('modalConfigAnimalFields');
};

window.switchConfigTab = async (type) => {
    selectedFormulaFields = []; // Limpiar selección al cambiar entre Ingreso/Salida
    const modal = document.getElementById('modalConfigAnimalFields');
    modal.dataset.tab = type;
    document.getElementById('btnTabIngreso').style.background = type === 'ingreso' ? '#00b894' : '#b2bec3';
    document.getElementById('btnTabSalida').style.background = type === 'salida' ? '#00b894' : '#b2bec3';
    document.getElementById('formulaFieldsContainer').classList.add('hidden');
    await renderAnimalConfigList();
};

// Manejador de clics para controlar el orden y límite de selección en fórmulas
window.handleFormulaFieldClick = (checkbox, op) => {
    if (checkbox.checked) {
        if ((op === 'formula_diff' || op === 'formula_add' || op === 'formula_div') && selectedFormulaFields.length >= 2) {
            checkbox.checked = false;
            return showToast("En Base - Total solo puede seleccionar 2 campos", "error");
        }
        selectedFormulaFields.push(checkbox.value);
    } else {
        selectedFormulaFields = selectedFormulaFields.filter(f => f !== checkbox.value);
    }
};

async function renderAnimalConfigList() {
    const modal = document.getElementById('modalConfigAnimalFields');
    const animalName = modal.dataset.animal;
    const formType = modal.dataset.tab;
    const container = document.getElementById('animalFieldsList');
    
    const { data, error } = await _supabase.from('animal_config')
        .select('*')
        .eq('animal_name', animalName)
        .eq('form_type', formType);
    
    if (error) return container.innerHTML = "Error al cargar configuración";
    
    container.innerHTML = data.map(f => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:white; padding:10px 15px; border-radius:6px; border:1px solid #dfe6e9; margin-bottom:8px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <div style="display: flex; align-items: center; gap: 15px; flex: 1;">
                <span style="font-weight:bold; color: #2d3436; font-size: 14px; min-width: 80px;">${f.field_label}</span> 
                <span style="color:${f.operation.includes('sum') || f.operation.includes('add') ? '#00b894' : (f.operation.includes('sub') || f.operation.includes('diff') ? '#d63031' : '#0984e3')}; font-size: 10px; font-weight: bold; background: #f8f9fa; padding: 2px 6px; border-radius: 4px; border: 1px solid #dfe6e9;">
                    ${f.operation === 'sum' ? 'SUMA' : (f.operation === 'sub' ? 'RESTA' : (f.operation === 'formula_sum' ? 'SUMATORIA' : (f.operation === 'formula_diff' ? 'BASE - TOTAL' : (f.operation === 'formula_add' ? 'BASE + TOTAL' : (f.operation === 'formula_div' ? 'DIVISIÓN' : 'INFO')))))}
                </span>
                ${f.allow_adjustment ? `
                    <span style="font-size: 9px; color: #6c5ce7; font-weight: bold; border: 1px solid #6c5ce7; padding: 1px 4px; border-radius: 3px;">+ AJUSTE</span>
                ` : ''}
                <div style="display: flex; align-items: center; gap: 5px;">
                    <input type="checkbox" ${f.is_editable && f.operation !== 'none' && !f.operation.startsWith('formula_') ? 'checked' : ''} disabled style="width: 13px; height: 13px; margin: 0; pointer-events: none;">
                    <span style="font-size: 11px; color: #636e72;">Editable</span>
                </div>
            </div>
            <button class="btn-cancel" style="width:30px; height:30px; padding:0; border-radius:50%; display: flex; align-items: center; justify-content: center;" onclick="deleteAnimalField(${f.id})">×</button>
        </div>
    `).join('');
}

window.saveAnimalField = async () => {
    const modal = document.getElementById('modalConfigAnimalFields');
    const animalName = modal.dataset.animal;
    const formType = modal.dataset.tab;
    const field_label = document.getElementById('newFieldName').value;
    const operation = document.getElementById('newFieldOp').value;
    const is_editable = (operation === 'none' || operation.startsWith('formula_')) ? false : document.getElementById('newFieldEditable').checked;
    const allow_adjustment = document.getElementById('newFieldAllowAdjustment').checked;
    const display_format = document.getElementById('newFieldDisplayFormat').value;

    if (!field_label) return showToast("Nombre del campo requerido", "error");

    // Validación: Permitir 1 o máximo 2 campos para operaciones de fórmula.
    if ((operation === 'formula_diff' || operation === 'formula_add' || operation === 'formula_div') && (selectedFormulaFields.length < 1 || selectedFormulaFields.length > 2)) {
        return showToast("Para esta operación debe seleccionar 1 o 2 campos", "error");
    }

    const { error } = await _supabase.from('animal_config').insert([{
        animal_name: animalName,
        form_type: formType,
        field_label,
        operation,
        is_editable,
        formula_fields: selectedFormulaFields.length > 0 ? JSON.stringify(selectedFormulaFields) : null,
        allow_adjustment: allow_adjustment,
        display_format: display_format
    }]);

    if (error) showToast("Error al guardar: " + error.message, "error");
    else {
        document.getElementById('newFieldName').value = "";
        showToast("Campo añadido");
        document.getElementById('formulaFieldsContainer').classList.add('hidden');
        selectedFormulaFields = [];
        renderAnimalConfigList();
    }
};

window.deleteAnimalField = async (id) => {
    const { error } = await _supabase.from('animal_config').delete().eq('id', id);
    if (error) showToast("Error al borrar", "error");
    else renderAnimalConfigList();
};

// --- Lógica de Ingreso de Animales ---

async function prepareInboundAnimalModal() {
    const select = document.getElementById('inboundAnimalProduct');
    const form = document.getElementById('formInboundAnimal');
    
    // Reiniciar formulario
    form.reset();
    delete form.dataset.mode;
    delete form.dataset.oldUnits;
    delete form.dataset.oldWeight;
    document.getElementById('animalStockDisplay').classList.add('hidden');

    // Ingeniería de Datos: Consultar productos marcados como animales
    const { data: animals, error } = await _supabase
        .from('products')
        .select('code, name, unit, weigth, medit')
        .eq('animal', true)
        .order('name');

    if (error) {
        console.error("Error al cargar animales:", error);
        showToast("Error al cargar animales", "error");
    }

    select.innerHTML = '<option value="" disabled selected hidden>Seleccione animal...</option>' +
        (animals || []).map(a => `<option value="${a.name}" data-code="${a.code}" data-unit="${a.unit}" data-weight="${a.weigth || 0}" data-medit="${a.medit || 'Unidad'}">${a.name}</option>`).join('');

    // Listeners de tiempo real
    const updateDisplay = () => calculateAnimalInboundTotals();
    document.getElementById('inboundAnimalUnitsQty').oninput = updateDisplay;
    document.getElementById('inboundAnimalWeightQty').oninput = updateDisplay;

    select.onchange = async () => {
        await loadDynamicProductionFields(select.value, 'ingreso');
        await loadAnimalInboundStock(select);
        updateDisplay();
    };
}

async function loadAnimalInboundStock(select) {
    const modalManage = document.getElementById('modalManageShedAnimals');
    const farm = modalManage?.dataset.farm;
    const shedNumber = modalManage?.dataset.number;

    const currentUnitsEl = document.getElementById('currentAnimalUnits');
    const currentWeightEl = document.getElementById('currentAnimalWeight');

    let currentUnits = 0;
    let currentWeight = 0;

    if (select && select.value && farm && shedNumber) {
        const productCode = select.options[select.selectedIndex]?.dataset.code;
        if (productCode) {
            const { data: batch, error: batchErr } = await _supabase
                .from('animal_batches')
                .select('id')
                .eq('animal_code', productCode)
                .eq('farm_name', farm)
                .eq('shed_number', shedNumber)
                .eq('status', 'active')
                .maybeSingle();

            if (!batchErr && batch?.id) {
                const { data: records, error: recordsError } = await _supabase
                    .from('animal_production_records')
                    .select('event_type, units, initial_weight, dynamic_data, created_at')
                    .eq('batch_id', batch.id);

                if (!recordsError && records?.length) {
                    records.forEach(rec => {
                        const factor = rec.event_type === 'ingreso' ? 1 : -1;
                        currentUnits += Number(rec.units) || 0;
                        currentWeight += Number(rec.initial_weight) || 0;
                    });

                    const latestIngreso = [...records].reverse().find(r => r.event_type === 'ingreso');
                    const currentDetails = latestIngreso?.dynamic_data || {};
                    select.dataset.currentDynamic = JSON.stringify(currentDetails);
                } else {
                    select.dataset.currentDynamic = JSON.stringify({});
                }
            }
        }
    }

    select.dataset.currentUnits = currentUnits;
    select.dataset.currentWeight = currentWeight;
    if (currentUnitsEl) currentUnitsEl.textContent = formatNumber(currentUnits);
    if (currentWeightEl) currentWeightEl.textContent = formatNumber(currentWeight);

    const currentDetailsEl = document.getElementById('currentAnimalDetails');
    if (currentDetailsEl) {
        const details = JSON.parse(select.dataset.currentDynamic || '{}');
        if (details && Object.keys(details).length > 0) {
            currentDetailsEl.innerHTML = Object.entries(details).map(([label, value]) => {
                const formatted = (typeof value === 'number' || !Number.isNaN(Number(value))) ? formatNumber(Number(value)) : value;
                return `<div><strong>${label}:</strong> ${formatted}</div>`;
            }).join('');
        } else {
            currentDetailsEl.innerHTML = '<div style="color:#636e72;">No hay datos de producción dinámica registrados para este lote.</div>';
        }
    }
}

async function prepareOutboundAnimalModal() {
    const form = document.getElementById('formOutboundAnimal');
    form.reset();
    delete form.dataset.batchId;
    delete form.dataset.inboundDynamicData;
    delete form.dataset.inboundInitialWeight;
    delete form.dataset.batchUnits;
    delete form.dataset.batchWeight;
    document.getElementById('batchStockDisplay')?.classList.add('hidden');

    const select = document.getElementById('outboundAnimalProduct');
    const modalManage = document.getElementById('modalManageShedAnimals');
    const farm = modalManage.dataset.farm;
    const shedNumber = modalManage.dataset.number;

    // Cargar solo animales de lotes activos en este galpón
    const { data: batches, error } = await _supabase
        .from('animal_batches')
        .select('id, animal_name, animal_code')
        .eq('farm_name', farm)
        .eq('shed_number', shedNumber)
        .eq('status', 'active');

    if (error) return showToast("Error al cargar lotes activos", "error");

    select.innerHTML = '<option value="" disabled selected hidden>Seleccione animal a retirar...</option>' +
        (batches || []).map(b => `<option value="${b.animal_name}" data-code="${b.animal_code}" data-batch-id="${b.id}">${b.animal_name}</option>`).join('');

    select.onchange = async () => {
        const batchId = select.options[select.selectedIndex].dataset.batchId;
        
        // Ingeniería de Datos: Calcular balance actual del LOTE sumando ingresos y restando salidas anteriores
        const { data: records } = await _supabase
            .from('animal_production_records')
            .select('event_type, units, initial_weight, dynamic_data')
            .eq('batch_id', batchId);
        
        // Rescatar datos dinámicos del ingreso para permitir cálculos cruzados (ej. Porcentaje)
        const inboundRec = (records || []).find(r => r.event_type === 'ingreso');
        form.dataset.inboundDynamicData = JSON.stringify(inboundRec?.dynamic_data || {});
        form.dataset.inboundInitialWeight = inboundRec?.initial_weight || 0;
        
        const balance = (records || []).reduce((acc, r) => {
            const factor = r.event_type === 'ingreso' ? 1 : -1;
            acc.units += r.units * factor;
            acc.weight += Number(r.initial_weight) * factor;
            return acc;
        }, { units: 0, weight: 0 });

        // Guardar balance en el formulario para validación posterior
        form.dataset.batchUnits = balance.units;
        form.dataset.batchWeight = balance.weight;
        form.dataset.batchId = batchId;

        await loadDynamicProductionFields(select.value, 'salida');
        calculateAnimalOutboundTotals();
    };

    const updateDisplay = () => calculateAnimalOutboundTotals();
    document.getElementById('outboundAnimalUnitsQty').oninput = updateDisplay;
    document.getElementById('outboundAnimalWeightQty').oninput = updateDisplay;
}

async function loadDynamicProductionFields(animalName, formType = 'ingreso') {
    const container = document.getElementById(formType === 'ingreso' ? 'dynamicProductionFields' : 'dynamicProductionFieldsOut');
    if (!container) return;
    const { data } = await _supabase.from('animal_config').select('*').eq('animal_name', animalName).eq('form_type', formType);
    
    if (!data || data.length === 0) {
        container.innerHTML = '<p style="font-size: 11px; color: #e17055; text-align: center;">Nota: Este animal no tiene campos de producción configurados.</p>';
        return;
    }

    container.innerHTML = data.map(f => {
        const isInfo = f.operation === 'none';
        const isFormula = f.operation.startsWith('formula_');
        const allowAdj = f.allow_adjustment;
        const isSum = f.operation === 'sum';
        
        return `
        <div class="input-group">
            <label style="font-size: 10px; font-weight: 700; color: ${isInfo ? '#0984e3' : '#636e72'}; text-transform: uppercase;">${f.field_label}:</label>
            <div style="display: flex; gap: 8px; align-items: stretch;">
                <input type="number" 
                       class="dynamic-prod-field ${isFormula ? 'result-field' : ''}" 
                       data-label="${f.field_label}" 
                       data-op="${f.operation}" 
                       data-formula-fields='${f.formula_fields || '[]'}'
                       data-display-format="${f.display_format || 'number'}"
                       placeholder="${isFormula ? 'Cálculo automático' : (isInfo ? 'Información' : '0.00')}" 
                       ${(isFormula || isInfo) ? 'readonly' : ''} 
                       style="${isInfo ? 'background: #ebf5fb; border-left: 3px solid #0984e3; color: #2c3e50;' : (isFormula ? 'background: #f1f3f5; font-weight: bold; border-left: 3px solid #6c5ce7;' : 'border-left: 3px solid #dfe6e9;')} padding: 6px 10px; height: 32px; font-size: 13px;"
                       step="any">
                ${isSum ? `
                    <input type="number" 
                           class="bultos-input" 
                           data-label="${f.field_label}" 
                           placeholder="Bultos" 
                           style="padding: 6px 8px; height: 32px; font-size: 13px; border-left: 3px solid #fdcb6e; background: #fffbf0;" 
                           min="0" step="1">
                ` : ''}
            </div>
        </div>
        ${allowAdj ? `
            <div style="margin-top: 3px; margin-bottom: 6px; padding-left: 10px; display: flex; align-items: center; gap: 5px;">
                <label style="font-size: 9px; color: #636e72; font-weight: bold; white-space: nowrap;">AJUSTE +/-:</label>
                <input type="number" 
                       class="adjustment-input" 
                       data-for="${f.field_label}" 
                       placeholder="0.00" 
                       style="height: 24px; font-size: 11px; padding: 2px 8px; border: 1px dashed #b2bec3; background: #fff; width: 80px;" 
                       step="any">
            </div>
        ` : ''}
    `}).join('');

    // Agregar listeners a los nuevos inputs
    container.querySelectorAll('input').forEach(input => {
        if (formType === 'ingreso') input.oninput = () => calculateAnimalInboundTotals();
        else input.oninput = () => calculateAnimalOutboundTotals();
    });
}

function calculateAnimalInboundTotals() {
    const select = document.getElementById('inboundAnimalProduct');
    const selected = select.options[select.selectedIndex];
    if (!selected || selected.disabled) return;

    // Entradas del formulario
    const inputUnits = parseFloat(document.getElementById('inboundAnimalUnitsQty').value) || 0;
    const initialWeight = parseFloat(document.getElementById('inboundAnimalWeightQty').value) || 0;

    // Datos base para proyecciones visuales (opcional)
    const stockUnits = parseFloat(selected.dataset.currentUnits ?? selected.dataset.unit) || 0;
    const stockWeight = parseFloat(selected.dataset.currentWeight ?? selected.dataset.weight) || 0;

    const form = document.getElementById('formInboundAnimal');
    const isEdit = form.dataset.mode === 'edit';
    const oldUnits = isEdit ? parseFloat(form.dataset.oldUnits) || 0 : 0;
    const oldWeight = isEdit ? parseFloat(form.dataset.oldWeight) || 0 : 0;

    // Mapear los valores vigentes por etiqueta de campo
    const fieldValues = {};
    fieldValues['Peso Inicial'] = parseFloat(document.getElementById('inboundAnimalWeightQty').value) || 0;

    // Paso 1: Obtener valores iniciales de TODOS los campos dinámicos
    document.querySelectorAll('#dynamicProductionFields .dynamic-prod-field').forEach(input => {
        fieldValues[input.dataset.label] = getNumericFieldValue(input);
    });

    // Función interna para procesar fórmulas y actualizar el mapa de valores
    const processFormulas = () => {
        document.querySelectorAll('#dynamicProductionFields .dynamic-prod-field.result-field').forEach(resInput => {
            const op = resInput.dataset.op;
            let targets = [];
            try { targets = JSON.parse(resInput.dataset.formulaFields || '[]'); } catch(e) {}
            const format = resInput.dataset.displayFormat;

            let resultVal = computeFormulaResult(op, targets, fieldValues);

            // Aplicar ajuste manual si existe el campo
            const adjInput = document.querySelector(`#dynamicProductionFields .adjustment-input[data-for="${resInput.dataset.label}"]`);
            const adjVal = parseFloat(adjInput?.value) || 0;
            const finalVal = resultVal + adjVal;

            if (format === 'percent') {
                resInput.type = "text"; // Cambiamos a texto para mostrar el símbolo %
                resInput.value = (finalVal * 100).toFixed(2) + '%';
            } else {
                resInput.type = "number";
                resInput.value = finalVal.toFixed(2);
            }

            if (op === 'formula_diff' || op === 'formula_add' || op === 'formula_div') resInput.style.color = finalVal < 0 ? '#d63031' : '#00b894';
            fieldValues[resInput.dataset.label] = finalVal;
        });
    };

    // Ejecutar doble pasada para asegurar que fórmulas que dependen de otras fórmulas se actualicen correctamente
    processFormulas();
    processFormulas();

    // Cálculo de Disponibilidad Real (Mermando en tiempo real del stock global)
    // Si es edición, sumamos lo anterior para calcular el impacto neto
    const diffUnits = inputUnits - oldUnits;
    const diffWeight = initialWeight - oldWeight;

    const availableUnits = stockUnits - diffUnits;
    const availableWeight = stockWeight - diffWeight;

    // Mostrar display de stock centrado
    const display = document.getElementById('animalStockDisplay');
    display.classList.remove('hidden');

    // Actualizar valores en pantalla (Reflejando disponibilidad proyectada)
    const unitsEl = document.getElementById('currentAnimalUnits');
    const weightEl = document.getElementById('currentAnimalWeight');
    
    unitsEl.textContent = formatNumber(availableUnits);
    weightEl.textContent = formatNumber(availableWeight);
    
    // Feedback visual de alerta si el stock se agota
    unitsEl.style.color = availableUnits < 0 ? '#d63031' : '#2d3436';
    weightEl.style.color = availableWeight < 0 ? '#d63031' : '#2d3436';
}

function calculateAnimalOutboundTotals() {
    const form = document.getElementById('formOutboundAnimal');
    const select = document.getElementById('outboundAnimalProduct');
    const selected = select.options[select.selectedIndex];
    if (!selected || selected.disabled) return;

    const inputUnits = parseFloat(document.getElementById('outboundAnimalUnitsQty').value) || 0;
    const inputWeight = parseFloat(document.getElementById('outboundAnimalWeightQty').value) || 0;

    // Balance del lote cargado previamente
    const batchUnits = parseFloat(form.dataset.batchUnits) || 0;
    const batchWeight = parseFloat(form.dataset.batchWeight) || 0;

    // Proyección del lote
    const projUnits = batchUnits - inputUnits;
    const projWeight = batchWeight - inputWeight;

    // Actualizar UI del Stock del Lote
    const display = document.getElementById('batchStockDisplay');
    display?.classList.remove('hidden');
    
    const unitsEl = document.getElementById('currentBatchUnits');
    const weightEl = document.getElementById('currentBatchWeight');
    if (unitsEl) unitsEl.textContent = formatNumber(projUnits);
    if (weightEl) weightEl.textContent = formatNumber(projWeight);
    
    if (unitsEl) unitsEl.style.color = projUnits < 0 ? '#d63031' : '#2d3436';
    if (weightEl) weightEl.style.color = projWeight < 0 ? '#d63031' : '#2d3436';

    const fieldValues = {};
    // Valor base del formulario (Salida)
    fieldValues['Peso Inicial'] = parseFloat(document.getElementById('outboundAnimalWeightQty').value) || 0;
    fieldValues['Peso Inicial (Ingreso)'] = parseFloat(form.dataset.inboundInitialWeight) || 0;

    // Cargar datos que venían del ingreso original para cálculos de rendimiento/porcentaje
    const inboundData = JSON.parse(form.dataset.inboundDynamicData || '{}');
    Object.assign(fieldValues, inboundData);

    document.querySelectorAll('#dynamicProductionFieldsOut .dynamic-prod-field').forEach(input => {
        if (!input.classList.contains('result-field')) {
            fieldValues[input.dataset.label] = getNumericFieldValue(input);
        }
    });

    document.querySelectorAll('#dynamicProductionFieldsOut .dynamic-prod-field.result-field').forEach(resInput => {
        const op = resInput.dataset.op;
        let targets = [];
        try { targets = JSON.parse(resInput.dataset.formulaFields || '[]'); } catch(e) {}
        const format = resInput.dataset.displayFormat;

        let resultVal = computeFormulaResult(op, targets, fieldValues);

        const adjInput = document.querySelector(`#dynamicProductionFieldsOut .adjustment-input[data-for="${resInput.dataset.label}"]`);
        const adjVal = parseFloat(adjInput?.value) || 0;
        const finalVal = resultVal + adjVal;

        if (format === 'percent') {
            resInput.type = "text";
            resInput.value = (finalVal * 100).toFixed(2) + '%';
        } else {
            resInput.type = "number";
            resInput.value = finalVal.toFixed(2);
        }
    });
}

// Ingeniería de Backend: Procesamiento del Ingreso de Animales al Galpón
document.getElementById('formInboundAnimal')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const isEdit = form.dataset.mode === 'edit';
    
    const productName = document.getElementById('inboundAnimalProduct').value;
    const units = parseFloat(document.getElementById('inboundAnimalUnitsQty').value) || 0;
    const initialWeight = parseFloat(document.getElementById('inboundAnimalWeightQty').value) || 0;
    const productCode = document.getElementById('inboundAnimalProduct').options[document.getElementById('inboundAnimalProduct').selectedIndex].dataset.code;

    // Recopilar datos dinámicos estructurados para la columna JSONB
    let productionData = {}; // Objeto para la columna JSONB
    document.querySelectorAll('#dynamicProductionFields .dynamic-prod-field').forEach(input => {
        productionData[input.dataset.label] = getNumericFieldValue(input);
    });
    // Incluir el ajuste manual en el JSON si existe
    document.querySelectorAll('#dynamicProductionFields .adjustment-input').forEach(adjInput => {
        const adjValue = parseFloat(adjInput.value) || 0;
        if (adjValue !== 0) {
            productionData[`Ajuste: ${adjInput.dataset.for}`] = adjValue;
        }
    });
    // Incluir bultos para campos de tipo 'sum'
    document.querySelectorAll('#dynamicProductionFields .bultos-input').forEach(bultosInput => {
        const bultosValue = parseInt(bultosInput.value) || 0;
        if (bultosValue > 0) {
            productionData[`Bultos: ${bultosInput.dataset.label}`] = bultosValue;
        }
    });

    // Filtrar solo los campos que en animal_config tengan operation = 'sum' para el inventario
    const { data: sumFields } = await _supabase
        .from('animal_config')
        .select('field_label')
        .eq('animal_name', productName)
        .eq('form_type', 'ingreso')
        .eq('operation', 'sum');

    const sumLabels = new Set((sumFields || []).map(f => f.field_label));

    const modalManage = document.getElementById('modalManageShedAnimals');
    const farm = modalManage.dataset.farm;
    const shedNumber = modalManage.dataset.number;

    if (!productName || !productCode) return showToast("Seleccione un animal", "error");

    // --- LÓGICA DE NUEVAS TABLAS ---

    // 1. Buscar o crear el lote de animales
    let { data: batch, error: batchError } = await _supabase
        .from('animal_batches')
        .select('id')
        .eq('animal_code', productCode)
        .eq('farm_name', farm)
        .eq('shed_number', shedNumber)
        .eq('status', 'active')
        .maybeSingle();

    if (batchError) return showToast("Error buscando lote: " + batchError.message, "error");

    if (!batch) {
        const { data: newBatch, error: newBatchError } = await _supabase
            .from('animal_batches')
            .insert({
                animal_code: productCode,
                animal_name: productName,
                farm_name: farm,
                shed_number: shedNumber,
                status: 'active'
            })
            .select('id')
            .single();
        
        if (newBatchError) return showToast("Error creando lote: " + newBatchError.message, "error");
        batch = newBatch;
    }

    // 2. Crear el registro de producción
    const { data: recordData, error: recordError } = await _supabase
        .from('animal_production_records')
        .insert({
            batch_id: batch.id,
            event_type: 'ingreso',
            units: units,
            initial_weight: initialWeight,
            dynamic_data: productionData
        })
        .select('id')
        .single();

    if (recordError) return showToast("Error guardando registro: " + recordError.message, "error");

    // --- Actualizar inventario de animales ---
    // Crear un registro individual en inventory por cada campo de productionData que tenga operation='sum' en config
    const invOps = Object.entries(productionData)
        .filter(([label, value]) => {
            const num = parseFloat(value);
            return sumLabels.has(label) && !isNaN(num) && num !== 0;
        })
        .map(async ([label, value]) => {
            const numValue = parseFloat(value);
            const { data: existingFieldInv, error: existingFieldError } = await _supabase
                .from('inventory')
                .select('id, amount')
                .eq('product', label)
                .eq('farm', farm)
                .eq('shed', String(shedNumber))
                .maybeSingle();

            if (existingFieldError) {
                console.error(`Error consultando inventario animal para campo ${label}:`, existingFieldError.message);
            } else if (!existingFieldInv) {
                const { error: invInsertError } = await _supabase.from('inventory').insert({
                    code: productCode,
                    product: label,
                    shed: String(shedNumber),
                    amount: numValue,
                    farm: farm,
                    provider: [],
                    medit: 'KG',
                    created_at: getColombiaTimestamp()
                });
                if (invInsertError) console.error(`Error creando inventario animal para campo ${label}:`, invInsertError.message);
            } else {
                const newAmount = (existingFieldInv.amount || 0) + numValue;
                const { error: invUpdateError } = await _supabase.from('inventory')
                    .update({ amount: newAmount })
                    .eq('id', existingFieldInv.id);
                if (invUpdateError) console.error(`Error actualizando inventario animal para campo ${label}:`, invUpdateError.message);
            }
        });

    await Promise.all(invOps);

    // Guardar registros de bultos por campo de suma
    const bultosEntriesIngreso = Object.entries(productionData)
        .filter(([key, value]) => key.startsWith('Bultos:') && parseFloat(value) > 0);

    if (bultosEntriesIngreso.length > 0 && recordData?.id) {
        const bultosInsertsIngreso = bultosEntriesIngreso.map(([key, value]) => {
            const fieldName = key.replace('Bultos: ', '');
            return _supabase.from('animal_production_bultos').insert({
                production_record_id: recordData.id,
                event_type: 'ingreso',
                field_name: fieldName,
                bultos: parseInt(value)
            });
        });
        await Promise.all(bultosInsertsIngreso);
    }

    showToast(isEdit ? "Registro actualizado" : "Animales ingresados al galpón correctamente");
    closeModals();
    if (window.CURRENT_INVENTORY_MODE === 'sheds') loadFilteredInventory('sheds');
});

// Ingeniería de Backend: Procesamiento de la Salida de Animales del Galpón
document.getElementById('formOutboundAnimal')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;

    const productName = document.getElementById('outboundAnimalProduct').value;
    const productCode = document.getElementById('outboundAnimalProduct').options[document.getElementById('outboundAnimalProduct').selectedIndex].dataset.code;
    const units = parseFloat(document.getElementById('outboundAnimalUnitsQty').value) || 0;
    const baseWeight = parseFloat(document.getElementById('outboundAnimalWeightQty').value) || 0;
    const batchId = form.dataset.batchId;

    let productionData = {};
    document.querySelectorAll('#dynamicProductionFieldsOut .dynamic-prod-field').forEach(input => {
        productionData[input.dataset.label] = getNumericFieldValue(input);
    });
    document.querySelectorAll('#dynamicProductionFieldsOut .adjustment-input').forEach(adjInput => {
        const adjValue = parseFloat(adjInput.value) || 0;
        if (adjValue !== 0) {
            productionData[`Ajuste: ${adjInput.dataset.for}`] = adjValue;
        }
    });
    // Incluir bultos para campos de tipo 'sum'
    document.querySelectorAll('#dynamicProductionFieldsOut .bultos-input').forEach(bultosInput => {
        const bultosValue = parseInt(bultosInput.value) || 0;
        if (bultosValue > 0) {
            productionData[`Bultos: ${bultosInput.dataset.label}`] = bultosValue;
        }
    });

    // Filtrar solo los campos que en animal_config tengan operation = 'sum' para el inventario
    const { data: sumFieldsOut } = await _supabase
        .from('animal_config')
        .select('field_label')
        .eq('animal_name', productName)
        .eq('form_type', 'salida')
        .eq('operation', 'sum');

    const sumLabelsOut = new Set((sumFieldsOut || []).map(f => f.field_label));

    const modalManage = document.getElementById('modalManageShedAnimals');
    const farm = modalManage.dataset.farm;
    const shedNumber = modalManage.dataset.number;

    if (!productName || !productCode) return showToast("Seleccione un animal", "error");

    // 1. Encontrar el lote activo
    let batch = null;
    if (batchId) {
        batch = { id: batchId };
    } else {
        const { data: queriedBatch, error: batchError } = await _supabase
            .from('animal_batches')
            .select('id')
            .eq('animal_code', productCode)
            .eq('farm_name', farm)
            .eq('shed_number', shedNumber)
            .eq('status', 'active')
            .single();
        if (batchError || !queriedBatch) return showToast("No se encontró un lote activo para este animal en el galpón.", "error");
        batch = queriedBatch;
    }

    // Validar disponibilidad REAL del LOTE (Entradas - Salidas previas)
    const batchUnitsAvail = parseFloat(form.dataset.batchUnits) || 0;
    const batchWeightAvail = parseFloat(form.dataset.batchWeight) || 0;

    if (units > batchUnitsAvail || baseWeight > batchWeightAvail) {
        return showToast(`Stock del lote insuficiente (Disponible: ${batchUnitsAvail} unid, ${batchWeightAvail} kg)`, "error");
    }

    // 2. Crear el registro de producción de salida
    const { data: outRec, error: outRecErr } = await _supabase.from('animal_production_records').insert({
        batch_id: batch.id,
        event_type: 'salida',
        units: units,
        initial_weight: baseWeight,
        dynamic_data: productionData
    }).select('id').single();

    if (outRecErr) return showToast("Error guardando registro de salida: " + outRecErr.message, "error");

    // --- Actualizar inventario de animales ---
    // Restar de cada registro individual en inventory por cada campo de productionData que tenga operation='sum' en config
    const invOpsOut = Object.entries(productionData)
        .filter(([label, value]) => {
            const num = parseFloat(value);
            return sumLabelsOut.has(label) && !isNaN(num) && num !== 0;
        })
        .map(async ([label, value]) => {
            const numValue = parseFloat(value);
            const { data: existingFieldInv, error: existingFieldError } = await _supabase
                .from('inventory')
                .select('id, amount')
                .eq('product', label)
                .eq('farm', farm)
                .eq('shed', String(shedNumber))
                .maybeSingle();

            if (existingFieldError) {
                console.error(`Error consultando inventario animal para campo ${label}:`, existingFieldError.message);
            } else if (!existingFieldInv) {
                console.warn(`No existe inventario del campo ${label} en este galpón para registrar la salida.`);
            } else {
                const newAmount = (existingFieldInv.amount || 0) - numValue;
                const { error: invUpdateError } = await _supabase.from('inventory')
                    .update({ amount: newAmount })
                    .eq('id', existingFieldInv.id);
                if (invUpdateError) console.error(`Error actualizando inventario animal para campo ${label}:`, invUpdateError.message);
            }
        });

    await Promise.all(invOpsOut);

    // Guardar registros de bultos por campo de suma
    const bultosEntriesSalida = Object.entries(productionData)
        .filter(([key, value]) => key.startsWith('Bultos:') && parseFloat(value) > 0);

    if (bultosEntriesSalida.length > 0 && outRec?.id) {
        const bultosInsertsSalida = bultosEntriesSalida.map(([key, value]) => {
            const fieldName = key.replace('Bultos: ', '');
            return _supabase.from('animal_production_bultos').insert({
                production_record_id: outRec.id,
                event_type: 'salida',
                field_name: fieldName,
                bultos: parseInt(value)
            });
        });
        await Promise.all(bultosInsertsSalida);
    }

    // 3. Actualizar stock global y ocupación del galpón
    const { data: prodData } = await _supabase.from('products').select('unit, weigth').eq('code', productCode).single();
    const newGlobalUnits = (prodData.unit || 0) - units;
    const newGlobalWeight = (prodData.weigth || 0) - baseWeight;
    await _supabase.from('products').update({ unit: newGlobalUnits, weigth: newGlobalWeight }).eq('code', productCode);
    await updateShedUsage(farm, parseInt(shedNumber), units, false);

    // Registrar movimiento histórico y asociarlo al primer registro de salida
    const { data: mvOut, error: mvOutErr } = await _supabase.from('movements').insert([{
        name: productName,
        type: 'salida_animal',
        amount: units,
        farm: farm,
        medit: 'KG',
        shed: String(shedNumber),
        description: `Salida procesada en Galpón ${shedNumber}`,
        production_data: productionData,
        created_at: getColombiaTimestamp()
    }]).select('id').single();

    if (mvOutErr) console.warn('Warning: movimiento salida no creado:', mvOutErr.message);
    if (mvOut && mvOut.id) {
        // Asociar al primer registro de salida de este lote
        const { data: firstOut, error: firstOutErr } = await _supabase
            .from('animal_production_records')
            .select('id')
            .eq('batch_id', batch.id)
            .eq('event_type', 'salida')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
        if (firstOut && firstOut.id) {
            await _supabase.from('animal_production_records').update({ movement_id: mvOut.id }).eq('id', firstOut.id);
        }
    }
    // 4. Verificar si el lote debe cerrarse
    const { data: records, error: recordsError } = await _supabase.from('animal_production_records').select('event_type, units').eq('batch_id', batch.id);
    if (!recordsError) {
        const totalUnits = records.reduce((acc, rec) => {
            return rec.event_type === 'ingreso' ? acc + rec.units : acc - rec.units;
        }, 0);

        if (totalUnits <= 0) {
            await _supabase.from('animal_batches').update({ status: 'closed' }).eq('id', batch.id);
            showToast("Lote finalizado y cerrado automáticamente.", "success");
        }
    }

    showToast("Salida de animales registrada correctamente");
    closeModals();
    if (window.CURRENT_INVENTORY_MODE === 'sheds') loadFilteredInventory('sheds');
});

// Ingeniería de Sistemas: Helper para actualizar la proyección de stock global en tiempo real
const updateEditInventoryStockProjection = () => {
    const form = document.getElementById('formEditInventory');
    if (!form || form.dataset.mode !== 'edit') return;

    const newAmount = parseFloat(document.getElementById('editInvAmountInput')?.value) || 0;
    const oldAmount = parseFloat(form.dataset.oldAmount) || 0;
    const oldProduct = form.dataset.oldProduct;
    
    const prodSelect = document.getElementById('editInvProductSelect');
    const newProduct = prodSelect.value;
    const selectedOpt = prodSelect.options[prodSelect.selectedIndex];

    if (!selectedOpt) return;
    const currentGlobal = parseFloat(selectedOpt.getAttribute('data-global')) || 0;
    let projectedGlobal = 0;
    if (newProduct === oldProduct) {
        // Misma referencia: El cambio afecta al stock global según la diferencia con lo anterior
        // Proyección = Stock Global Actual - (Nueva Cantidad en Granja - Cantidad Anterior en Granja)
        projectedGlobal = currentGlobal - (newAmount - oldAmount);
    } else {
        // Cambio de producto: El stock global del NUEVO producto disminuye por la nueva cantidad asignada
        projectedGlobal = currentGlobal - newAmount;
    }

    const availableInput = document.getElementById('editInvAvailableInput');
    if (availableInput) availableInput.value = formatNumber(projectedGlobal);
};

// Ingeniería de Sistemas: Helper para configurar listeners del modal de edición
function setupEditInventoryListeners() {
    const prodSelect = document.getElementById('editInvProductSelect');
    const farmSelect = document.getElementById('editInvFarmSelect');
    const shedSelect = document.getElementById('editInvShedSelect');
    const amountInput = document.getElementById('editInvAmountInput');

    prodSelect?.addEventListener('change', async function() {
        const selected = this.options[this.selectedIndex];
        if (!selected.value) return;
        document.getElementById('editInvCategorySpan').textContent = "N/A"; // Ya no hay categoría
        document.getElementById('editInvGlobalStock').textContent = formatNumber(selected.getAttribute('data-global')) || '0';
        document.getElementById('editInvUnitInput').value = selected.getAttribute('data-medit');
        document.getElementById('editInvShedContainer').classList.add('hidden'); // Shed is not part of product inventory editing
        
        const { data: provs } = await _supabase.from('providers').select('name, product');
        const availableProvs = provs?.filter(p => Array.isArray(p.product) && p.product.some(prod => normalizeText(prod) === normalizeText(selected.value))) || [];
        const provSelect = document.getElementById('editInvProviderSelect');
        const currentProv = document.getElementById('formEditInventory').dataset.currentProv;
        provSelect.innerHTML = '<option value="" disabled selected hidden>Seleccione el proveedor</option>' + 
            availableProvs.map(p => `<option value="${p.name}" ${p.name === currentProv ? 'selected' : ''}>${p.name}</option>`).join('');

        updateEditInventoryStockProjection();
    });

    amountInput?.addEventListener('input', updateEditInventoryStockProjection);
    farmSelect?.addEventListener('change', async function() { /* No longer populating sheds here */ });
}

window.editInventoryItem = async (idOrProduct) => {
    let query = _supabase.from('inventory').select('*');
    if (!isNaN(idOrProduct) && !String(idOrProduct).includes(':')) query = query.eq('id', idOrProduct);
    else query = query.eq('product', idOrProduct);

    const { data: inv, error } = await query.single();
    if (error || !inv) return showToast("Error al cargar datos", "error");

    const form = document.getElementById('formEditInventory');
    form.dataset.mode = 'edit';
    form.dataset.id = inv.id;
    form.dataset.oldAmount = inv.amount;
    form.dataset.oldProduct = inv.product;
    form.dataset.oldFarm = inv.farm;
    form.dataset.oldShed = ""; // Shed is no longer relevant for product inventory
    form.dataset.currentProv = Array.isArray(inv.provider) ? inv.provider[0] : inv.provider;
    form.dataset.currentShed = inv.shed || "";

    // Cargar selectores
    const { data: prods } = await _supabase.from('products').select('name, medit, code, unit').order('name'); // Ya no se selecciona 'categorie'
    const prodSelect = document.getElementById('editInvProductSelect');
    prodSelect.innerHTML = prods.map(p => `<option value="${p.name}" data-medit="${p.medit}" data-code="${p.code}" data-global="${p.unit}">${p.name}</option>`).join(''); // Ya no se usa data-cat
    prodSelect.value = inv.product;

    const { data: farms } = await _supabase.from('farms').select('name').order('name');
    const farmSelect = document.getElementById('editInvFarmSelect');
    farmSelect.innerHTML = farms.map(f => `<option value="${f.name}">${f.name}</option>`).join('');
    farmSelect.value = inv.farm;

    document.getElementById('editInvAmountInput').value = inv.amount;

    // Disparar eventos para poblar campos secundarios y calcular proyección inicial
    prodSelect.dispatchEvent(new Event('change'));
    // farmSelect.dispatchEvent(new Event('change')); // No longer needed for sheds

    showModal('modalEditInventory');
};

document.getElementById('formEditInventory')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const id = form.dataset.id;
    const oldAmount = parseFloat(form.dataset.oldAmount);
    const oldProduct = form.dataset.oldProduct;
    const oldFarm = form.dataset.oldFarm;
    const oldShed = ""; // Shed is no longer relevant for product inventory

    const newProduct = document.getElementById('editInvProductSelect').value;
    const newFarm = document.getElementById('editInvFarmSelect').value;
    const newShed = document.getElementById('editInvShedSelect').value;
    const newAmount = parseFloat(document.getElementById('editInvAmountInput').value);
    const newProvider = document.getElementById('editInvProviderSelect').value;
    const prodOpt = document.getElementById('editInvProductSelect').options[document.getElementById('editInvProductSelect').selectedIndex];
    
    // Sincronización de Stock Global
    if (newProduct === oldProduct) {
        const diff = newAmount - oldAmount;
        const { data: p } = await _supabase.from('products').select('unit').eq('name', newProduct).single();
        if (diff > 0 && (!p || p.unit < diff)) return showToast("Stock insuficiente en catálogo", "error");
        await _supabase.from('products').update({ unit: (p?.unit || 0) - diff }).eq('name', newProduct);
    } else {
        const { data: pOld } = await _supabase.from('products').select('unit').eq('name', oldProduct).single();
        const { data: pNew } = await _supabase.from('products').select('unit').eq('name', newProduct).single();
        if (pNew && pNew.unit < newAmount) return showToast(`Stock insuficiente de ${newProduct}`, "error");
        await _supabase.from('products').update({ unit: (pOld?.unit || 0) + oldAmount }).eq('name', oldProduct);
        await _supabase.from('products').update({ unit: (pNew?.unit || 0) - newAmount }).eq('name', newProduct);
    }

    const { error } = await _supabase.from('inventory').update({ // Update inventory item
        code: prodOpt.dataset.code, product: newProduct, farm: newFarm, shed: null, // Mantener shed como null para productos
        amount: newAmount, provider: newProvider ? [newProvider] : [], medit: prodOpt.dataset.medit // Mantener medit
    }).eq('id', id);

    if (error) showToast("Error: " + error.message, "error");
    else { showToast("Registro actualizado y sincronizado"); closeModals(); loadFilteredInventory(window.CURRENT_INVENTORY_MODE); }
});

window.deleteInventoryItem = async (idOrProduct) => {
    if (!confirm("¿Desea eliminar este registro del inventario?")) return;
    
    // Ingeniería de Sistemas: Manejo polimórfico de eliminación para evitar errores de tipo en DB
    let query = _supabase.from('inventory').delete();
    
    if (!isNaN(idOrProduct) && !String(idOrProduct).includes(':')) {
        query = query.eq('id', idOrProduct);
    } else {
        query = query.eq('product', idOrProduct);
    }

    const { error } = await query;
    if (error) showToast("Error: " + error.message, "error");
    else { showToast("Registro eliminado"); loadFilteredInventory(window.CURRENT_INVENTORY_MODE); }
};
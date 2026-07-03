// Credenciales de conexión proporcionadas
const SUPABASE_URL = "https://zvxnksnsovtlczausrvl.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2eG5rc25zb3Z0bGN6YXVzcnZsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY3Nzc0NSwiZXhwIjoyMDkxMjUzNzQ1fQ.ai6JYAE43_HCmIXTR6McoTHkEi0wYuMszqCQn-pMhaA";
// IMPORTANTE: La clave anterior es la service_role_key y NO debe ser expuesta en el frontend.
// Para operaciones de cliente y llamadas a Edge Functions, se debe usar la anon public key.
const SUPABASE_ANON_PUBLIC_KEY = "TU_SUPABASE_ANON_PUBLIC_KEY_AQUI"; // <--- DEBES REEMPLAZAR ESTO CON TU CLAVE ANON PUBLIC

// Inicialización del cliente de Supabase (Ingeniería de Backend en el Cliente)
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let CURRENT_USER_ROLE = "";
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

const formatSalePrice = (salePrice) => {
    if (salePrice === null || salePrice === undefined) return 'No aplica';
    if (typeof salePrice === 'object' && salePrice !== null) {
        return Object.entries(salePrice)
            .map(([key, value]) => `${key}: $ ${formatNumber(value)}`)
            .join(', ');
    }
    return `$ ${formatNumber(salePrice)}`;
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

// Ingeniería de Sistemas: Generador de código correlativo automático para inventario
const generateNextInventoryCode = async (count = 1) => {
    const { data, error } = await _supabase
        .from('products')
        .select('inventory_code') // Seleccionar la columna correcta
        .not('inventory_code', 'is', null)
        .order('inventory_code', { ascending: false }) // Ordenar por la columna correcta
        .limit(1);

    if (error || !data || data.length === 0) {
        return Array.from({ length: count }, (_, i) => String(100001 + i));
    }

    let startCode = parseInt(data[0].inventory_code || '100000') + 1;
    
    return Array.from({ length: count }, (_, i) => String(startCode + i));
};

// Ingeniería de Sistemas: Generador de código correlativo automático para productos
const generateNextProductCode = async () => {
    const { data, error } = await _supabase
        .from('products')
        .select('base_code')
        .order('base_code', { ascending: false })
        .limit(1);

    if (error || !data || data.length === 0) {
        return "100001";
    }

    let nextCode = parseInt(data[0].base_code) + 1;
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
        renderProductsView();
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
let modalStack = [];

function showModal(id) {
    const overlay = document.getElementById('modalOverlay');
    overlay.classList.remove('hidden');
    
    const currentOpen = document.querySelector('.modal:not(.hidden)');
    if (currentOpen && currentOpen.id !== id) {
        modalStack.push(currentOpen.id);
        currentOpen.classList.add('hidden');
    }
    
    const modal = document.getElementById(id);

    // Ingeniería de Sistemas: Resetear estado de edición al abrir como "Nuevo"
    const form = modal.querySelector('form');
    if (form) {
        const isEdit = form.dataset.mode === 'edit';
        if (id === 'modalCreateProduct' || id === 'modalCreateFarm' || (!isEdit && id !== 'modalEditShed')) {
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
                // Generar código automáticamente al abrir para nuevo producto (definición)
                generateNextProductCode().then(code => {
                    document.getElementById('prodCode').value = code;
                });
                document.getElementById('prodTotalProjection').textContent = "$ 0";
                
                // Resetear campos de peso y animales
                const checkWeight = document.getElementById('prodHasWeight');
                if (checkWeight) {
                    checkWeight.checked = false;
                    document.getElementById('prodWeightContainer').classList.add('hidden');
                }
                const isAnimalCheck = document.getElementById('prodIsAnimal');
                const forSaleCheck = document.getElementById('prodForSale');
                if (forSaleCheck) {
                    forSaleCheck.checked = true;
                    updateSalePriceVisibility();
                }
            }
        }
    }

    modal.classList.remove('hidden');

    if(id === 'modalCreateUser') prepareRoleDropdown();
    if(id === 'modalUpdateData') prepareUpdateFields();
    if(id === 'modalCreateSupplier') loadProductsForSelect(); // Esta línea es correcta, carga productos para proveedores.
    if(id === 'modalInboundInventory') prepareInboundModal();
    if(id === 'modalOutboundInventory') prepareOutboundModal();
    if(id === 'modalListCategories') renderCategoriesList();
    if(id === 'modalBaseProducts') renderBaseProducts();
    if(id === 'modalOutboundInventory') prepareOutboundModal();
}

function closeModals(clearStack = true) {
    const current = document.querySelector('.modal:not(.hidden)');
    if (current) {
        current.classList.add('hidden');
    }
    
    if (clearStack) {
        modalStack = [];
        document.getElementById('modalOverlay').classList.add('hidden');
    } else {
        const previous = modalStack.pop();
        if (previous) {
            document.getElementById(previous).classList.remove('hidden');
        } else {
            document.getElementById('modalOverlay').classList.add('hidden');
        }
    }
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
    document.getElementById('inventoryView')?.classList.add('hidden'); // Vista de Galpones
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

// FASE 8.2: Gestión de Galpones (Creación y Autonumeración)
async function loadAnimalsForShed(targetSelect) {
    const animalSelect = targetSelect || document.getElementById('shedAnimal');

    // Ingeniería de Datos: Cargar animales desde la tabla 'products' donde animal=true
    const { data: animals, error } = await _supabase
        .from('products')
        .select('name')
        .eq('animal', true)
        .eq('inventory', false) // Solo definiciones de producto
        .order('name');

    if (error) {
        console.error("Error al cargar tipos de animales:", error);
        animalSelect.innerHTML = '<option value="">Error al cargar animales</option>';
        return;
    }

    animalSelect.innerHTML = '<option value="" disabled selected hidden>Seleccione animal...</option>' + 
        (animals?.map(a => `<option value="${a.name}">${a.name}</option>`).join('') || '');
    if (!animals || animals.length === 0) {
        animalSelect.innerHTML = '<option value="">No hay productos marcados como animales</option>';
    }
}

async function prepareShedModal() {
    const farmSelect = document.getElementById('shedFarm');
    const animalSelect = document.getElementById('shedAnimal');
    const isEdit = document.getElementById('formCreateShed').dataset.mode === 'edit';
    
    const { data: farms } = await _supabase.from('farms').select('name').order('name');
    farmSelect.innerHTML = '<option value="">Seleccione granja...</option>' + 
        (farms?.map(f => `<option value="${f.name}">${f.name}</option>`).join('') || '');
    await loadAnimalsForShed(animalSelect); // Cargar los animales desde la tabla products
    
    if (!isEdit) document.getElementById('shedNumber').value = "";
}

document.getElementById('shedFarm')?.addEventListener('change', async function() {
    const farmName = this.value;
    if (!farmName) return;

    if (document.getElementById('formCreateShed').dataset.mode !== 'edit') {
        const { data } = await _supabase.from('sheds').select('id').eq('farm', farmName);
        const nextNumber = (data?.length || 0) + 1;
        document.getElementById('shedNumber').value = nextNumber;
    } // No es necesario recargar animales aquí, ya se cargaron al abrir el modal
});

document.getElementById('formCreateShed')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const shedData = {
        number: parseInt(document.getElementById('shedNumber').value),
        farm: document.getElementById('shedFarm').value,
        animal: document.getElementById('shedAnimal').value,
        created_at: getColombiaTimestamp()
    };

    // Lógica simplificada solo para inserción
    const { error } = await _supabase.from('sheds').insert([shedData]);

    if (error) {
        showToast("Error al registrar galpón: " + error.message, "error");
    } else {
        showToast("Galpón registrado exitosamente");
        closeModals();
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
    
    // Cargar tanto definiciones (inventory=false) como productos existentes en inventario (inventory=true)
    const { data: baseProds } = await _supabase.from('products').select('name, unit, medit, base_code, animal, weigth').eq('inventory', false).order('name');
    const { data: invProds } = await _supabase.from('products').select('name, unit, medit, base_code, animal, weigth').eq('inventory', true).order('name');

    const allProds = [
        ...(baseProds || []).map(p => ({ ...p, type: 'base' })),
        ...(invProds || []).map(p => ({ ...p, type: 'inventory' }))
    ];

    // Eliminar duplicados por nombre, dando prioridad a los de inventario
    const uniqueProds = Array.from(new Map(allProds.map(p => [p.name, p])).values());
    
    prodSelect.innerHTML = '<option value="" disabled selected hidden>Seleccione producto...</option>' + 
        uniqueProds.map(p => `
            <option value="${p.name}" data-unit='${JSON.stringify(p.unit)}' data-medit='${JSON.stringify(p.medit)}' data-code="${p.base_code}" data-animal="${p.animal}" data-weigth='${JSON.stringify(p.weigth || null)}'>
                ${p.name} ${p.type === 'inventory' ? '(Existente)' : ''}
            </option>`).join('');

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

    const inboundUnitsContainer = document.getElementById('inboundUnitsContainer');
    inboundUnitsContainer.innerHTML = ''; // Limpiar campos anteriores

    const productName = selected.value;
    const weigthData = JSON.parse(selected.getAttribute('data-weigth') || 'null');
    const meditData = JSON.parse(selected.getAttribute('data-medit') || '[]');
    const isAnimal = selected.getAttribute('data-animal') === 'true';

    if (weigthData && typeof weigthData === 'object' && Object.keys(weigthData).length > 0) {
        // Generar campos dinámicos desde el objeto weigth
        inboundUnitsContainer.innerHTML = Object.entries(weigthData).map(([medit, unit]) => `
            <div style="flex: 1;">
                <label style="font-size: 12px; color: #636e72;">Unidades (${medit}):</label>
                <input type="text" class="inbound-unid-input" data-medit="${medit}" placeholder="0">
            </div>
        `).join('');
    } else {
        // Fallback a un solo campo si no hay weigth
        inboundUnitsContainer.innerHTML = `
            <div style="flex: 1;"><label style="font-size: 12px; color: #636e72;">Unidades (${meditData[0] || 'N/A'}):</label><input type="text" class="inbound-unid-input" data-medit="${meditData[0] || ''}" placeholder="0"></div>
        `;
    }

    document.getElementById('inboundExtraFields').classList.remove('hidden');
    // Mostrar/ocultar galpón si es animal
    document.getElementById('inboundShedContainer').classList.toggle('hidden', !isAnimal);

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

document.getElementById('inboundFarm')?.addEventListener('change', async function() {
    const farmName = this.value;
    const prodSelect = document.getElementById('inboundProduct');
    const isAnimal = prodSelect.options[prodSelect.selectedIndex]?.dataset.animal === 'true';

    if (isAnimal && farmName) {
        const shedSelect = document.getElementById('inboundShed');
        const { data, error } = await _supabase.from('sheds').select('number').eq('farm', farmName).order('number');
        if (error) return;
        shedSelect.innerHTML = '<option value="">Seleccione galpón...</option>' + 
            (data?.map(s => `<option value="${s.number}">${s.number}</option>`).join('') || '');
    }
});

document.getElementById('formInboundInventory')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const selectedOption = document.getElementById('inboundProduct').options[document.getElementById('inboundProduct').selectedIndex];
    const productName = selectedOption.value;
    const baseCode = selectedOption.dataset.code;
    const inboundUnid = parseInt(document.getElementById('inboundUnid').value.replace(/\./g, '')) || 0;
    const weigthData = {};
    document.querySelectorAll('.inbound-unid-input').forEach(input => {
        const medit = input.dataset.medit;
        const value = parseFloat(input.value.replace(/\./g, '')) || 0;
        if (medit && value > 0) weigthData[medit] = value;
    });

    const farmName = document.getElementById('inboundFarm').value;
    const entranceDate = document.getElementById('inboundDate').value;
    const providerName = document.getElementById('inboundProvider').value;
    const description = document.getElementById('inboundDescription').value;
    const shedValue = document.getElementById('inboundShed').value;

    // 1. Registrar movimiento en Kardex
    const { error: moveError } = await _supabase.from('movements').insert([{
        name: productName,
        type: "ingreso",
        amount: inboundUnid,
        farm: farmName, // La medida se infiere del producto
        shed: shedValue || null,
        date_movement: entranceDate,
        provider: providerName || "",
        description: description,
        created_at: getColombiaTimestamp()
    }]);

    if (moveError) {
        showToast("Error al registrar movimiento: " + moveError.message, "error");
        return;
    }

    // 2. Buscar si ya existe un item de inventario para este producto en esta granja
    let { data: currentProd, error: currentProdError } = await _supabase
        .from('products')
        .select('id, unit, provider')
        .eq('base_code', baseCode)
        .eq('farm', farmName)
        .eq('inventory', true)
        .maybeSingle();

    let updateError;
    if (!currentProd) {
        // NO EXISTE: Se crea un nuevo registro de producto para esa granja
        const { data: pData } = await _supabase.from('products').select('*').eq('base_code', baseCode).eq('inventory', false).limit(1).single();
        if (!pData) return showToast("Error: No se encontró la definición del producto base.", "error");

        const { error: insErr } = await _supabase.from('products').insert([{
            base_code: pData.base_code,
            inventory_code: await generateNextInventoryCode(),
            name: pData.name,
            medit: pData.medit,
            buy_price: pData.buy_price,
            sale_price: pData.sale_price,
            animal: pData.animal,
            to_sale: pData.to_sale,
            inventory: true,
            farm: farmName,
            unit: Object.values(weigthData)[0] || 0, // Tomar el primer valor como principal
            weigth: weigthData,
            provider: providerName ? [providerName] : [],
            entrance_date: entranceDate,
            created_at: getColombiaTimestamp() // Añadir la fecha de creación
        }]);
        updateError = insErr;
    } else {
        // SÍ EXISTE: Se actualiza el stock (unit) y la fecha de entrada
        const newWeigth = { ...(currentProd.weigth || {}) };
        Object.entries(weigthData).forEach(([medit, value]) => {
            newWeigth[medit] = (newWeigth[medit] || 0) + value;
        });

        let providersArray = Array.isArray(currentProd.provider) ? currentProd.provider : [];
        if (providerName && !providersArray.includes(providerName)) {
            providersArray.push(providerName);
        }

        const { error: updErr } = await _supabase
            .from('products')
            .update({ 
                unit: Object.values(newWeigth)[0] || 0, // Actualizar unit principal
                weigth: newWeigth, 
                provider: providersArray, entrance_date: entranceDate })
            .eq('id', currentProd.id);
        updateError = updErr;
    }

    if (updateError) {
        showToast("Error al actualizar existencias: " + updateError.message, "error");
    } else {
        // 3. Actualizar (restar) el stock del producto base
        const { data: baseProd, error: baseErr } = await _supabase.from('products').select('unit').eq('base_code', baseCode).eq('inventory', false).single();
        if (baseErr) {
            showToast("Advertencia: Ingreso guardado, pero no se pudo actualizar el stock base.", "error");
        } else {
            const newBaseStock = (baseProd.unit || 0) - inboundUnid;
            await _supabase.from('products').update({ unit: newBaseStock }).eq('base_code', baseCode).eq('inventory', false);
        }


        showToast("Ingreso de inventario procesado correctamente");
        
        // Ingeniería de Interfaz: Limpieza total de los datos para el próximo registro
        e.target.reset();
        document.getElementById('inboundExtraFields').classList.add('hidden');
        document.getElementById('inboundShedInfo').classList.add('hidden');
        
        closeModals();
        renderProductsView();
    }
});

window.deleteProduct = async (base_code) => {
    if (!confirm(`¿Está seguro de eliminar la definición del producto con código ${base_code}?`)) return;
    const { error } = await _supabase.from('products').delete().eq('base_code', base_code);
    if (error) {
        showToast("Error al eliminar producto: " + error.message, "error");
    } else {
        showToast("Definición de producto eliminada.");
        renderBaseProducts(); // Refrescar la lista de productos base
    }
};

// FASE 6.4: Ingeniería de Salidas de Inventario
async function prepareOutboundModal() {
    const prodSelect = document.getElementById('outboundProduct');
    const extraFields = document.getElementById('outboundExtraFields');
    extraFields.classList.add('hidden');
    
    // Resetear y habilitar campos por defecto
    prodSelect.disabled = false; // Habilitar por defecto
    // El input de granja ya es readonly, no necesita deshabilitarse.
    document.getElementById('outboundShed').disabled = true; // El galpón no se usa para productos
    document.getElementById('formOutboundInventory').reset();

    // Poner fecha actual por defecto
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('outboundDate').value = today;

    // Carga de productos desde la tabla products (que ahora es el inventario)
    const { data: productsInfo } = await _supabase
        .from('products')
        .select('id, name, unit, medit, farm, weigth')
        .eq('inventory', true) // Mostrar todos los productos que son parte del inventario físico
        .order('name');
    
    prodSelect.innerHTML = '<option value="" disabled selected hidden>Seleccione producto...</option>' + 
        (productsInfo || []).map(p => `<option value="${p.id}" data-unit='${JSON.stringify(p.unit)}' data-medit='${JSON.stringify(p.medit)}' data-name="${p.name}" data-farm="${p.farm}" data-weigth='${JSON.stringify(p.weigth || null)}'>${p.name}</option>`).join('');
}

document.getElementById('outboundProduct')?.addEventListener('change', function() {
    const selected = this.options[this.selectedIndex];
    if (!selected.value) return;
    
    const farmName = selected.dataset.farm;
    const weigthData = JSON.parse(selected.getAttribute('data-weigth') || 'null');
    const outboundUnitsContainer = document.getElementById('outboundUnitsContainer');
    outboundUnitsContainer.innerHTML = '';

    document.getElementById('outboundFarm').value = farmName || "";
    document.getElementById('outboundDescription').value = "";

    if (weigthData && typeof weigthData === 'object' && Object.keys(weigthData).length > 0) {
        outboundUnitsContainer.innerHTML = Object.entries(weigthData).map(([medit, stock]) => `
            <div style="flex: 1;">
                <label style="font-size: 12px; color: #636e72;">Unidades (${medit}):</label>
                <input type="text" class="outbound-unid-input" data-medit="${medit}" placeholder="0" data-max="${stock}">
                <div style="font-size: 11px; color: #636e72; text-align: center;">Disp: ${formatNumber(stock)}</div>
            </div>
        `).join('');
    } else {
        const stock = JSON.parse(selected.dataset.unit || '0');
        const medit = JSON.parse(selected.dataset.medit || '[]')[0] || 'N/A';
        outboundUnitsContainer.innerHTML = `
            <div style="flex: 1;"><label style="font-size: 12px; color: #636e72;">Unidades (${medit}):</label><input type="text" class="outbound-unid-input" data-medit="${medit}" placeholder="0" data-max="${stock}"><div style="font-size: 11px; color: #636e72; text-align: center;">Disp: ${formatNumber(stock)}</div></div>
        `;
    }

    document.getElementById('outboundExtraFields').classList.remove('hidden');
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
    
    const productSelect = document.getElementById('outboundProduct');
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const productId = selectedOption.value;
    const productName = selectedOption.dataset.name;
    
    const weigthData = {};
    let hasExceededStock = false;
    document.querySelectorAll('.outbound-unid-input').forEach(input => {
        const medit = input.dataset.medit;
        const value = parseFloat(input.value.replace(/\./g, '')) || 0;
        const max = parseFloat(input.dataset.max) || 0;
        if (value > max) hasExceededStock = true;
        if (medit && value > 0) weigthData[medit] = value;
    });

    if (hasExceededStock) return showToast("La cantidad de salida excede el stock disponible.", "error");

    const farmName = document.getElementById('outboundFarm').value;
    const moveDate = document.getElementById('outboundDate').value;
    const description = document.getElementById('outboundDescription').value;

    // 2. Actualización de tabla products (Resta de stock)
    const { data: currentProd, error: prodError } = await _supabase
        .from('products')
        .select('unit')
        .eq('id', productId)
        .single();

    if (prodError || !currentProd) {
        showToast("Error: No se encontró el producto en el inventario.", "error");
        return;
    }

    const newWeigth = { ...(currentProd.weigth || {}) };
    Object.entries(weigthData).forEach(([medit, value]) => {
        newWeigth[medit] = (newWeigth[medit] || 0) - value;
    });

    const { error: updateError } = await _supabase.from('products').update({ 
        unit: Object.values(newWeigth)[0] || 0,
        weigth: newWeigth,
        description: description 
    }).eq('id', productId);

    // Registrar movimiento en Kardex por cada medida afectada
    for (const [medit, value] of Object.entries(weigthData)) {
        if (value > 0) {
            await _supabase.from('movements').insert([{
                name: productName, type: "salida", amount: value, farm: farmName,
                medit: medit, date_movement: moveDate, provider: "",
                description: description, created_at: getColombiaTimestamp()
            }]);
        }
    }
    
    if (updateError) {
        showToast("Error al actualizar existencias: " + updateError.message, "error");
    } else {
        showToast("Salida de inventario procesada correctamente");
        e.target.reset(); // Limpia el formulario
        document.getElementById('outboundExtraFields').classList.add('hidden');
        closeModals();
        renderProductsView();
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
        animals: [document.getElementById('farmAnimal').value]
    };

    let result;
    if (isEdit) {
        result = await _supabase.from('farms').update(farmData).eq('name', form.dataset.originalId);
    } else {
        farmData.created_at = getColombiaTimestamp();
        result = await _supabase.from('farms').insert([farmData]);
    }

    const { error } = result;

    if (error) {
        showToast("Error al crear granja: " + error.message, "error");
    } else {
        showToast(isEdit ? "Granja actualizada exitosamente" : "Granja creada exitosamente");
        closeModals();
        document.getElementById('btnGestionGranjas').click();
    }
});

// FASE 4.1: Ingeniería de Backend y Frontend para Gestión de Granjas
document.getElementById('btnGestionGranjas').addEventListener('click', async () => {
    // Gestión de Interfaz: Conmutación de vistas
    document.getElementById('usersView').classList.add('hidden');
    document.getElementById('suppliersView').classList.add('hidden');
    document.getElementById('productsView')?.classList.add('hidden');
    document.getElementById('inventoryView')?.classList.add('hidden');
    const farmsView = document.getElementById('farmsView');
    farmsView.classList.remove('hidden');
    
    const tableContainer = document.getElementById('farmsTableContainer');
    tableContainer.innerHTML = "<p style='padding:20px;'>Cargando datos de granjas...</p>";

    // Consulta a la tabla 'farms'
    const { data, error } = await _supabase
        .from('farms')
        .select('name, address, animals');

    if (error) {
        console.error("Error al obtener datos de granjas:", error);
        tableContainer.innerHTML = `<p class="error-msg">Error: ${error.message}</p>`;
        return;
    }

    renderFarmsTable(data);
    document.getElementById('welcomeMessage')?.classList.add('hidden');
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
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${farms.map(f => `
                    <tr>
                        <td>${f.name || 'Sin nombre'}</td>
                        <td>${f.address || 'N/A'}</td>
                        <td>${Array.isArray(f.animals) && f.animals.length > 0 ? f.animals.join(', ') : 'No aplica'}</td>
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
    document.getElementById('productsView').classList.add('hidden');
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
    renderProductsView();
});

document.getElementById('btnGestionInventario')?.addEventListener('click', () => {
    document.getElementById('welcomeMessage')?.classList.add('hidden');
    renderInventoryView('sheds');
});

function renderProductsTable(products) {
    const tableContainer = document.getElementById('productsTableContainer');

    const formatWeightData = (p) => {
        if (p.weigth && typeof p.weigth === 'object' && Object.keys(p.weigth).length > 0) {
            return Object.entries(p.weigth)
                .map(([key, value]) => `${formatNumber(value)} ${key}`)
                .join(', ');
        }
        return `${formatNumber(p.unit)} ${Array.isArray(p.medit) ? p.medit.join(', ') : p.medit}`;
    };

    let html = `
        <table>
            <thead>
                <tr>
                    <th>Código</th>
                    <th>Nombre</th>
                    <th>Granja</th>
                    <th>Cantidad</th>
                    <th style="width: 160px;">Precio Venta</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${products.length === 0 ? '<tr><td colspan="6" style="text-align:center;">No hay datos para mostrar en este momento</td></tr>' : products.map(p => `
                    <tr>
                        <td>${p.inventory_code || p.base_code || 'No aplica'}</td>
                        <td>${p.name || 'Sin nombre'}</td>
                        <td>${p.farm || 'No aplica'}</td>
                        <td>${formatWeightData(p)}</td>
                        <td>${formatSalePrice(p.sale_price)}</td>
                        <td>
                            <div style="display:flex; gap:5px;">
                            <button class="action-btn" style="margin:0; padding:5px 10px; background: #0984e3;" onclick="editInventoryItem('${p.id}')">Editar</button>
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #d63031;" onclick="deleteProduct('${p.base_code}')">Borrar</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
    tableContainer.innerHTML = html;
}

async function renderBaseProducts() {
    const container = document.getElementById('baseProductsListContainer');
    container.innerHTML = "<p style='padding:20px; text-align:center;'>Cargando definiciones de productos...</p>";

    const { data, error } = await _supabase.from('products').select('*').eq('inventory', false).order('name');

    if (error) {
        return container.innerHTML = `<p class="error-msg">Error al cargar productos base: ${error.message}</p>`;
    }

    const formatWeightData = (p) => {
        if (p.weigth && typeof p.weigth === 'object' && Object.keys(p.weigth).length > 0) {
            return Object.entries(p.weigth)
                .map(([key, value]) => `${formatNumber(value)} ${key}`)
                .join(', ');
        }
        return `${formatNumber(p.unit)} ${Array.isArray(p.medit) ? p.medit.join(', ') : p.medit}`;
    };

    let html = `
        <table>
            <thead>
                <tr>
                    <th>Código</th><th>Nombre</th><th>Cantidad</th><th>Precio Compra</th><th>Precio Venta</th><th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${data.length === 0 ? '<tr><td colspan="6" style="text-align:center;">No hay productos definidos.</td></tr>' : data.map(p => `
                    <tr>
                        <td>${p.base_code || 'No aplica'}</td>
                        <td>${p.name}</td>
                        <td>${formatWeightData(p)}</td>
                        <td>${p.buy_price === null ? 'No aplica' : `$ ${formatNumber(p.buy_price)}`}</td>
                        <td>${formatSalePrice(p.sale_price)}</td>
                        <td>
                            <div style="display:flex; gap:5px;">
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #0984e3;" onclick="editProduct('${p.base_code}')">Editar</button>
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #d63031;" onclick="deleteProduct('${p.base_code}')">Borrar</button>
                            </div>
                        </td>
                    </tr>`).join('')}
            </tbody>
        </table>`;
    container.innerHTML = html;
}

function updateSalePriceVisibility() {
    const forSaleCheck = document.getElementById('prodForSale');
    const salePriceContainer = document.getElementById('prodSalePriceContainer');
    const salePrice = document.getElementById('prodSalePrice');
    if (!forSaleCheck || !salePriceContainer || !salePrice) return;
    const hasWeight = document.getElementById('prodHasWeight')?.checked;
    const salePriceKgContainer = document.getElementById('prodSalePriceKgContainer');

    if (forSaleCheck.checked) {
        salePriceContainer.classList.remove('hidden');
        if (hasWeight && salePriceKgContainer) salePriceKgContainer.classList.remove('hidden');
    } else {
        salePriceContainer.classList.add('hidden');
        salePrice.removeAttribute('required');
        if (salePriceKgContainer) salePriceKgContainer.classList.add('hidden');
    }
}

// FASE 12: Actualizar placeholder del precio de venta según la medida seleccionada.
document.getElementById('prodMedit')?.addEventListener('change', function() {
    const salePriceInput = document.getElementById('prodSalePrice');
    if (salePriceInput) {
        const selectedMedit = this.options[this.selectedIndex].text;
        const newPlaceholder = `Precio venta (${selectedMedit})`;
        salePriceInput.placeholder = newPlaceholder;
    }
});

// FASE 12: Actualizar placeholder del precio de venta según la medida seleccionada.
document.getElementById('prodMedit')?.addEventListener('change', function() {
    const salePriceInput = document.getElementById('prodSalePrice');
    if (salePriceInput) {
        const selectedMedit = this.options[this.selectedIndex].text;
        const newPlaceholder = `Precio venta (${selectedMedit})`;
        salePriceInput.placeholder = newPlaceholder;
    }
});

document.getElementById('prodForSale')?.addEventListener('change', updateSalePriceVisibility);

document.getElementById('prodHasWeight')?.addEventListener('change', (e) => {
    const weightContainer = document.getElementById('prodWeightContainer');
    const salePriceKgContainer = document.getElementById('prodSalePriceKgContainer');
    const forSale = document.getElementById('prodForSale')?.checked;

    if (e.target.checked) {
        // Ingeniería de Sistemas: Verificación de existencia de elementos para evitar errores de null.
        if (weightContainer) weightContainer.classList.remove('hidden');
        // La visibilidad del precio por KG ahora se controla en updateSalePriceVisibility
    } else {
        if (weightContainer) weightContainer.classList.add('hidden');
        if (salePriceKgContainer) salePriceKgContainer.classList.add('hidden');
    }
    updateSalePriceVisibility();
});

document.getElementById('formCreateProduct')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const isEdit = form.dataset.mode === 'edit';
    const unit = parseFloat(document.getElementById('prodUnit').value) || 0;
    const buyPrice = parseInt(document.getElementById('prodBuyPrice').value.replace(/\./g, '')) || 0;
    const hasWeight = document.getElementById('prodHasWeight')?.checked;
    const toSale = document.getElementById('prodForSale')?.checked !== false;

    // Ingeniería de Datos: Validación para prevenir duplicados de productos base
    if (!isEdit) {
        const baseCode = document.getElementById('prodCode').value;
        const { data: existing, error: checkError } = await _supabase
            .from('products')
            .select('base_code')
            .eq('base_code', baseCode)
            .eq('inventory', false)
            .maybeSingle();

        if (checkError) return showToast("Error de validación: " + checkError.message, "error");
        if (existing) return showToast(`Error: Ya existe una definición de producto con el código ${baseCode}.`, "error");
    }


    let productData = {
        base_code: document.getElementById('prodCode').value,
        name: document.getElementById('prodName').value,
        buy_price: buyPrice,
        total: unit * buyPrice,
        animal: false,
        to_sale: toSale
    };

    // FASE 11: Lógica para guardar precios de venta en JSONB
    const selectedMedit = document.getElementById('prodMedit').value;
    if (toSale) {
        if (hasWeight) {
            const priceUnit = parseInt(document.getElementById('prodSalePrice').value.replace(/\./g, '')) || 0;
            const priceKg = parseInt(document.getElementById('prodSalePriceKg').value.replace(/\./g, '')) || 0;
            productData.sale_price = { [selectedMedit]: priceUnit, 'KG': priceKg };
        } else {
            const priceUnit = parseInt(document.getElementById('prodSalePrice').value.replace(/\./g, '')) || 0;
            productData.sale_price = { [selectedMedit]: priceUnit };
        }
    } else {
        productData.sale_price = null;
    }

    // Nueva lógica para `medit` (array) y `weigth` (jsonb)
    productData.medit = [selectedMedit];
    productData.unit = unit; // `unit` sigue siendo la cantidad principal

    if (hasWeight) {
        productData.medit.push('KG');
        productData.weigth = {
            [selectedMedit]: unit,
            'KG': parseFloat(document.getElementById('prodWeight').value) || 0
        };
    } else {
        productData.weigth = null;
    }

    let result;
    if (isEdit) {
        const originalId = form.dataset.originalId;
        // Determinar si estamos editando una definición (por base_code) o un item de inventario (por id)
        const isInventoryItem = form.dataset.isInventory === 'true';
        const idColumn = isInventoryItem ? 'id' : 'base_code';

        result = await _supabase.from('products').update(productData).eq(idColumn, originalId);
    } else {
        productData.inventory = false; // Nuevo producto es una definición, no está en inventario
        productData.created_at = getColombiaTimestamp();
        result = await _supabase.from('products').insert([productData]);
    }

    const { error } = result;
    if (error) showToast("Error al agregar producto: " + error.message, "error");
    else { 
        showToast(isEdit ? "Producto actualizado" : "Producto agregado exitosamente"); 
        closeModals(); 
        // Refrescar la vista correcta
        const isInventoryItem = form.dataset.isInventory === 'true';
        if (isInventoryItem) renderProductsView();
        else renderBaseProducts();
    }
});

async function loadFarmsForProductModal() {
    const farmSelect = document.getElementById('prodAnimalFarm');
    const { data, error } = await _supabase.from('farms').select('name').order('name');
    if (error) return;
    farmSelect.innerHTML = '<option value="">Seleccione granja...</option>' + 
        (data?.map(f => `<option value="${f.name}">${f.name}</option>`).join('') || '');
}

async function loadShedsForProductModal(farmName) {
    const shedSelect = document.getElementById('prodAnimalShed');
    if (!farmName) {
        shedSelect.innerHTML = '<option value="">Seleccione granja primero</option>';
        return;
    }
    const { data, error } = await _supabase.from('sheds').select('number').eq('farm', farmName).order('number');
    if (error) return;
    shedSelect.innerHTML = '<option value="">Seleccione galpón...</option>' + 
        (data?.map(s => `<option value="${s.number}">${s.number}</option>`).join('') || '');
}

document.getElementById('prodAnimalFarm')?.addEventListener('change', function() {
    loadShedsForProductModal(this.value);
});

async function loadFilteredInventory(mode) {
    const search = normalizeText(document.getElementById('searchInventoryInput')?.value);
    const farm = document.getElementById('filterInventoryFarm')?.value;
    const category = document.getElementById('filterInventoryCategory')?.value;
    const animal = document.getElementById('filterInventoryAnimal')?.value;
    const shed = document.getElementById('filterInventoryShed')?.value;
    const date = document.getElementById('filterInventoryDate')?.value; // Este filtro ahora aplica a products
    const tableContainer = document.getElementById('productsTableContainer');

    tableContainer.innerHTML = "<p style='padding:20px;'>Cargando productos...</p>";

    let query = _supabase.from('products').select('*').eq('inventory', true); // Mostrar solo productos en inventario
    if (farm && farm !== 'all') query = query.eq('farm', farm);
    if (shed && shed !== 'all') query = query.eq('shed', shed);
    if (date) query = query.gte('created_at', `${date}T00:00:00`).lte('created_at', `${date}T23:59:59`);

    const { data, error } = await query;
    if (error) {
        tableContainer.innerHTML = `<p class="error-msg">Error cargando productos: ${error.message}</p>`;
        return;
    }

    let filtered = data || [];

    if (search) {
        filtered = filtered.filter(item => 
            normalizeText(item.name).includes(search) || 
            normalizeText(item.inventory_code).includes(search)
        );
    }

    renderProductsTable(filtered);
}

async function renderProductsView() {
    window.CURRENT_VIEW_MODE = 'products';
    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    document.getElementById('productsView').classList.remove('hidden');

    const tableContainer = document.getElementById('productsTableContainer');
    tableContainer.innerHTML = "<p style='padding:40px; text-align:center; color:#636e72;'>Realice una búsqueda o seleccione un filtro para visualizar los productos</p>";

    // Configurar filtros
    const searchInput = document.getElementById('searchInventoryInput');
    const farmSelect = document.getElementById('filterInventoryFarm');
    const shedSelect = document.getElementById('filterInventoryShed');
    const dateInput = document.getElementById('filterInventoryDate');

    [searchInput, farmSelect, shedSelect, dateInput].forEach(el => {
        if (el) el.onchange = () => loadFilteredInventory('products');
    });
    if (searchInput) searchInput.oninput = () => loadFilteredInventory('products');

    // Poblar filtros
    const { data: farms } = await _supabase.from('farms').select('name').order('name');
    if (farmSelect) {
        farmSelect.innerHTML = '<option value="" disabled selected hidden>Filtrar por granja...</option><option value="all">Todas</option>' +
            (farms?.map(f => `<option value="${f.name}">${f.name}</option>`).join('') || '');
    }
    const { data: sheds } = await _supabase.from('sheds').select('number').order('number');
    if (shedSelect) {
        const uniqueSheds = [...new Set(sheds?.map(s => s.number))] || [];
        shedSelect.innerHTML = '<option value="" disabled selected hidden>Filtrar por galpón...</option><option value="all">Ver todos los galpones</option>' +
            uniqueSheds.map(s => `<option value="${s}">${s}</option>`).join('');
    }
}

// FASE 6.1: Ingeniería de Backend y Frontend para Gestión de Inventario
document.getElementById('btnGestionInventario')?.addEventListener('click', () => {
    document.getElementById('welcomeMessage')?.classList.add('hidden');
    renderInventoryView('products');
});

async function renderInventoryView(mode) {
    // Gestión de Interfaz: Conmutación de vistas
    document.getElementById('usersView').classList.add('hidden');
    document.getElementById('farmsView').classList.add('hidden');
    document.getElementById('suppliersView').classList.add('hidden');
    document.getElementById('productsView').classList.add('hidden');
    const inventoryView = document.getElementById('inventoryView');
    inventoryView.classList.remove('hidden');
    
    const tableContainer = document.getElementById('inventoryTableContainer');
    tableContainer.innerHTML = "<p style='padding:40px; text-align:center; color:#636e72;'>Cargando galpones...</p>";

    const { data, error } = await _supabase.from('sheds').select('*');
    if (error) {
        tableContainer.innerHTML = `<p class="error-msg">Error: ${error.message}</p>`;
        return;
    }
    renderShedsTable(data);
}

function renderShedsTable(data) {
    const tableContainer = document.getElementById('inventoryTableContainer');
    tableContainer.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Número</th>
                    <th>Granja</th>
                    <th>Animal</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${data.length === 0 ? '<tr><td colspan="4" style="text-align:center;">No hay datos para mostrar con los filtros seleccionados</td></tr>' : data.map(s => `
                    <tr>
                        <td>${s.number}</td>
                        <td>${s.farm}</td>
                        <td>${s.animal || 'N/A'}</td>
                        <td>
                            <div style="display:flex; gap:5px;">
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #0984e3;" onclick="editShed('${s.farm}', ${s.number})">Editar</button>
                                <button class="action-btn" style="margin:0; padding:5px 10px; background: #d63031;" onclick="deleteShed('${s.farm}', ${s.number})">Borrar</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
}

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

// Formateo de precios en el registro de productos y cálculo de proyección
['prodBuyPrice', 'prodSalePrice', 'prodSalePriceKg'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('input', function(e) {
        let val = e.target.value.replace(/\D/g, '');
        e.target.value = formatNumber(val);
        updateProductTotalProjection();
    });
});
document.getElementById('prodUnit')?.addEventListener('input', updateProductTotalProjection);

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
    document.querySelector('#formCreateFarm button[type="submit"]').textContent = "Actualizar";
    
    document.getElementById('farmName').value = data.name;
    document.getElementById('farmAddress').value = data.address;
    document.getElementById('farmAnimal').value = Array.isArray(data.animals) && data.animals.length > 0 ? data.animals[0] : '';
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
    // FIX DEFINITIVO: El error 406 persiste porque .single() es estricto.
    // Se cambia la lógica para tomar el primer resultado de un posible array,
    // lo que evita el error y permite la edición incluso con duplicados existentes.
    const { data: results, error } = await _supabase.from('products')
        .select('*')
        .eq('base_code', code)
        .eq('inventory', false)
        .limit(1);

    const data = results ? results[0] : null;
    if (error || !data) return showToast("Error al cargar datos del producto", "error");

    const form = document.getElementById('formCreateProduct');
    form.dataset.mode = 'edit';
    form.dataset.originalId = code;
    showModal('modalCreateProduct');
    document.querySelector('#modalCreateProduct h4').textContent = "Editar Producto";
    document.querySelector('#formCreateProduct button[type="submit"]').textContent = "Actualizar Producto";

    document.getElementById('prodName').value = data.name;
    document.getElementById('prodMedit').value = Array.isArray(data.medit) ? data.medit[0] : data.medit;
    document.getElementById('prodUnit').value = data.unit;
    document.getElementById('prodBuyPrice').value = formatNumber(data.buy_price);
    
    const salePriceInput = document.getElementById('prodSalePrice');
    if (typeof data.sale_price === 'object' && data.sale_price !== null) {
        const selectedMedit = Array.isArray(data.medit) ? data.medit[0] : data.medit;
        salePriceInput.value = formatNumber(data.sale_price[selectedMedit] || data.sale_price['KG'] || Object.values(data.sale_price)[0] || 0);
    } else {
        salePriceInput.value = formatNumber(data.sale_price);
    }

    // Poblar campos de peso
    const hasWeight = data.weigth !== null;
    const checkWeight = document.getElementById('prodHasWeight');
    if (checkWeight) {
        checkWeight.checked = hasWeight;
        document.getElementById('prodWeightContainer').classList.toggle('hidden', !hasWeight);
        document.getElementById('prodWeight').value = hasWeight ? (data.weigth.KG || 0) : "";
    }

    const forSaleCheck = document.getElementById('prodForSale');
    if (forSaleCheck) {
        forSaleCheck.checked = data.to_sale !== false; // true por defecto
        updateSalePriceVisibility();
    }

    document.getElementById('prodCode').value = data.base_code;
    updateProductTotalProjection();
};

window.editShed = async (farm, number) => {
    const { data, error } = await _supabase.from('sheds').select('*').eq('farm', farm).eq('number', number).single();
    if (error || !data) return showToast("Error al cargar datos del galpón", "error");

    // Ahora usamos el nuevo formulario de edición
    const form = document.getElementById('formEditShed');
    form.dataset.originalId = `${farm}-${number}`; // Identificador compuesto
    showModal('modalEditShed');

    // Cargar y configurar los campos del formulario de edición
    const fSelect = document.getElementById('editShedFarm');
    const aSelect = document.getElementById('editShedAnimal');
    const { data: farms } = await _supabase.from('farms').select('name').order('name');
    fSelect.innerHTML = '<option value="">Seleccione granja...</option>' + 
        (farms?.map(f => `<option value="${f.name}">${f.name}</option>`).join('') || '');
    fSelect.value = data.farm;

    await loadAnimalsForShed(aSelect); // Pasar el selector correcto para cargar los animales
    document.getElementById('editShedNumber').value = data.number;
    aSelect.value = data.animal;
};

window.deleteShed = async (farm, number) => {
    if (!confirm(`¿Está seguro de eliminar el galpón ${number} de la granja ${farm}?`)) return;
    const { error } = await _supabase.from('sheds').delete().eq('farm', farm).eq('number', number);
    if (error) showToast("Error: " + error.message, "error");
    else { 
        showToast("Galpón eliminado"); 
        renderInventoryView('sheds'); 
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
    
    // Limpiar resultados de parámetros al abrir
    document.getElementById('statsResultContainer').innerHTML = '<p style="text-align:center; color: #b2bec3;">Seleccione un rango de fechas y presione "Calcular" para ver los resultados.</p>';
    document.getElementById('statsDateStart').value = '';
    document.getElementById('statsDateEnd').value = '';

    // Mostrar el modal
    showModal('modalManageShedAnimals');
};

async function renderShedAnimalRecords(farm, number) {
    const inboundBody = document.getElementById('shedAnimalInboundTableBody');
    const outboundBody = document.getElementById('shedAnimalOutboundTableBody');
    const inboundPricesBody = document.getElementById('inboundPricesTableBody');
    const outboundPricesBody = document.getElementById('outboundPricesTableBody');

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
        if(inboundPricesBody) inboundPricesBody.innerHTML = '<div style="text-align:center; padding: 15px; color: #b2bec3;">No hay datos de precios.</div>';
        if(outboundPricesBody) outboundPricesBody.innerHTML = '<div style="text-align:center; padding: 15px; color: #b2bec3;">No hay datos de precios.</div>';
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
        if(inboundPricesBody) inboundPricesBody.innerHTML = '<div style="text-align:center; padding: 15px; color: #d63031;">Error cargando precios.</div>';
        if(outboundPricesBody) outboundPricesBody.innerHTML = '<div style="text-align:center; padding: 15px; color: #d63031;">Error cargando precios.</div>';
        return showToast("Error cargando movimientos de animales", "error");
    }

    // Build animal list (no selector): show most recent animal for this shed
    const animalOptions = Array.from(new Set((batches || []).map(b => b.animal_name))).sort();
    const label = document.getElementById('shedAnimalLabel');
    const defaultAnimal = batches.length > 0 ? batches[0].animal_name : '';
    if (label) {
        label.innerHTML = `Animal: <span style="color: #00b894;">${defaultAnimal || '--'}</span>`;
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

    const buildGroupedHtml = (list, includePrices = false) => {
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
                    // Si estamos en la tabla de precios, solo nos interesan los precios.
                    if (includePrices && !k.startsWith('Precio: ')) return;
                    // Si NO estamos en la tabla de precios, ignoramos los precios.
                    if (!includePrices && k.startsWith('Precio: ')) return;

                    const val = dyn[k] || 0;
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
                    if (groups[group][k] === undefined) groups[group][k] = { sum: 0, count: 0, op: cfg?.op, display: (opMap[k]?.display || 'number') };
                    groups[group][k].sum += parseFloat(val) || 0;
                    groups[group][k].count += 1;
                });
            });

            // Build HTML: header with totalWeight and totalUnits, then grouped rows
            let html = `<div style="padding:10px; display:flex; gap:20px; justify-content:center; font-weight:bold; color:#2d3436;"><div>Peso Inicial: ${formatNumber(totalWeight)} KG</div><div>Unidades: ${formatNumber(totalUnits)}</div></div>`;
            
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
                    ${labels.map(l => {
                        const headerLabel = combinedItems[l].op === 'sum' ? `${l} KG` : l;
                        return `<th style="text-align:center; padding:6px; font-size:13px; color:#636e72; border:1px solid #bdbdbd; font-weight:700;">${headerLabel}</th>`;
                    }).join('')}
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
    const inboundHtml = await buildGroupedHtml(inbound, false);
    const outboundHtml = await buildGroupedHtml(outbound, false);
    const inboundPricesHtml = await buildGroupedHtml(inbound, true);
    const outboundPricesHtml = await buildGroupedHtml(outbound, true);

    inboundBody.innerHTML = `<div style="padding:10px;">${inboundHtml}</div>`;
    outboundBody.innerHTML = `<div style="padding:10px;">${outboundHtml}</div>`;

    // Poblar el nuevo modal de precios
    if(inboundPricesBody) inboundPricesBody.innerHTML = `<div style="padding:10px;">${inboundPricesHtml}</div>`;
    if(outboundPricesBody) outboundPricesBody.innerHTML = `<div style="padding:10px;">${outboundPricesHtml}</div>`;
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
    delete form.dataset.lastSummations;
    delete form.dataset.oldUnits;
    delete form.dataset.oldWeight;
    document.getElementById('animalStockDisplay').classList.add('hidden');

    // Ingeniería de Datos: Consultar productos marcados como animales
    const { data: animals, error } = await _supabase
        .from('products')
        .select('base_code, name, unit, weigth, medit')
        .eq('animal', true)
        .order('name');

    if (error) {
        console.error("Error al cargar animales:", error);
        showToast("Error al cargar animales", "error");
    }

    select.innerHTML = '<option value="" disabled selected hidden>Seleccione animal...</option>' +
        (animals || []).map(a => `<option value="${a.name}" data-base-code="${a.base_code}" data-unit="${a.unit}" data-weight="${a.weigth?.KG || 0}" data-medit="${a.medit || 'Unidad'}">${a.name}</option>`).join('');

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

    select.dataset.lastSummations = "{}";
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
        (batches || []).map(b => `<option value="${b.animal_name}" data-base-code="${b.animal_code}" data-batch-id="${b.id}">${b.animal_name}</option>`).join('');

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
            <label style="font-size: 10px; font-weight: 700; color: ${isInfo ? '#0984e3' : '#636e72'}; text-transform: uppercase;">${f.field_label}${isSum ? ' KG' : ''}:</label>
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
                     <input type="number" 
                            class="price-dynamic-input" 
                            data-label="${f.field_label}" 
                            placeholder="Precio x bulto" 
                            style="padding: 6px 8px; height: 32px; font-size: 13px; border-left: 3px solid #0984e3; background: #ebf5fb; width: 100px;" 
                            min="0" step="1000">
                     <input type="number" 
                            class="price-kg-dynamic-input" 
                            data-label="${f.field_label}" 
                            placeholder="Precio x KG" 
                            style="padding: 6px 8px; height: 32px; font-size: 13px; border-left: 3px solid #e17055; background: #fef9e7; width: 100px;" 
                            step="any">
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

// FASE 13: Listener para mostrar/ocultar precios por KG
['inboundRegisterPriceKg', 'outboundRegisterPriceKg'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', function() {
        const containerId = id.startsWith('inbound') ? 'dynamicProductionFields' : 'dynamicProductionFieldsOut';
        document.querySelectorAll(`#${containerId} .price-kg-dynamic-input`).forEach(input => input.classList.toggle('hidden', !this.checked));
    });
});

function calculateAnimalInboundTotals() {
    const select = document.getElementById('inboundAnimalProduct');
    const selected = select.options[select.selectedIndex];
    if (!selected || selected.disabled) return;

    // Entradas del formulario
    const unitsInput = document.getElementById('inboundAnimalUnitsQty');
    let inputUnits = parseFloat(unitsInput.value) || 0;
    const weightInput = document.getElementById('inboundAnimalWeightQty');
    let initialWeight = parseFloat(weightInput.value) || 0;
    
    // Datos base para proyecciones visuales (opcional)
    const stockUnits = parseFloat(selected.dataset.unit) || 0;
    const stockWeight = parseFloat(selected.dataset.weight) || 0;

    // Lógica de bloqueo para unidades y peso
    if (inputUnits > stockUnits) {
        unitsInput.value = stockUnits;
        inputUnits = stockUnits;
    }
    if (initialWeight > stockWeight) {
        weightInput.value = stockWeight;
        initialWeight = stockWeight;
    }

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
    // Cargar datos que venían del ingreso original para cálculos de rendimiento/porcentaje
    const inboundData = JSON.parse(form.dataset.inboundDynamicData || '{}');
    for (const [key, value] of Object.entries(inboundData)) {
        fieldValues[`${key} (ingreso)`] = value;
    }

    // Valores base del formulario actual (Salida)
    fieldValues['Peso Inicial'] = parseFloat(document.getElementById('outboundAnimalWeightQty').value) || 0;
    // Añadir el peso inicial del ingreso con su identificador de origen
    fieldValues['Peso Inicial (ingreso)'] = parseFloat(form.dataset.inboundInitialWeight) || 0;

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
    
    const select = document.getElementById('inboundAnimalProduct');
    const productName = document.getElementById('inboundAnimalProduct').value;
    const units = parseFloat(document.getElementById('inboundAnimalUnitsQty').value) || 0;
    const initialWeight = parseFloat(document.getElementById('inboundAnimalWeightQty').value) || 0;
    const productCode = document.getElementById('inboundAnimalProduct').options[document.getElementById('inboundAnimalProduct').selectedIndex].dataset.baseCode;

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
    // Incluir precios dinámicos por campo de tipo 'sum'
    document.querySelectorAll('#dynamicProductionFields .price-dynamic-input').forEach(priceInput => {
        const priceValue = parseInt(priceInput.value.replace(/\D/g, '')) || 0;
        if (priceValue > 0) {
            productionData[`Precio: ${priceInput.dataset.label}`] = priceValue;
        }
    });
    // FASE 13: Incluir precios por KG
    document.querySelectorAll('#dynamicProductionFields .price-kg-dynamic-input').forEach(priceInput => {
        const priceValue = parseInt(priceInput.value.replace(/\D/g, '')) || 0;
        if (priceValue > 0) {
            // Guardar en un formato que podamos identificar, ej: "Precio KG: Chocolate"
            productionData[`Precio KG: ${priceInput.dataset.label}`] = priceValue;
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

    // Generar todos los códigos de inventario necesarios de una sola vez
    const subProductsToCreate = Object.keys(productionData).filter(label => sumLabels.has(label));
    const inventoryCodes = await generateNextInventoryCode(subProductsToCreate.length);

    const modalManage = document.getElementById('modalManageShedAnimals');
    const farm = modalManage.dataset.farm;
    const shedNumber = modalManage.dataset.number;

    if (!productName || !productCode) return showToast("Seleccione un animal", "error");

    // --- LÓGICA DE NUEVAS TABLAS ---

    // 1. Buscar o crear el lote de animales
    let batch = null;
    if (isEdit) {
        batch = { id: form.dataset.batchId };
    } else {
        const { data, error } = await _supabase.from('animal_batches').select('id').eq('animal_code', productCode).eq('farm_name', farm).eq('shed_number', shedNumber).eq('status', 'active').maybeSingle();
        if (error) return showToast("Error buscando lote: " + error.message, "error");
        batch = data;
    }

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

    // Si después de todo, no hay lote, detenemos la ejecución.
    if (!batch || !batch.id) {
        return showToast("No se pudo determinar el lote de animales para el registro.", "error");
    }
    // 2. Crear el registro de producción
    // Separar precios dinámicos de los datos de producción
    let priceDynamic = {};
    Object.entries(productionData).forEach(([key, value]) => {
        if (key.startsWith('Precio: ')) {
            const fieldName = key.replace('Precio: ', '');
            priceDynamic[`${fieldName} bulto`] = value;
        }
        // FASE 13: Añadir precios por KG al objeto price_dynamic
        if (key.startsWith('Precio KG: ')) {
            const fieldName = key.replace('Precio KG: ', '');
            priceDynamic[`${fieldName}_KG`] = value; // ej: Chocolate_KG
        }
    });

    const { data: recordData, error: recordError } = await _supabase
        .from('animal_production_records')
        .insert({
            batch_id: batch.id,
            event_type: 'ingreso',
            units: units,
            initial_weight: initialWeight,
            dynamic_data: productionData,
            price_dynamic: Object.keys(priceDynamic).length > 0 ? priceDynamic : null
        })
        .select('id')
        .single();

    if (recordError) return showToast("Error guardando registro: " + recordError.message, "error");

    // --- Actualizar inventario de animales ---
    // Crear un registro individual en inventory por cada campo de productionData que tenga operation='sum' en config
    const invOps = Object.entries(productionData)
        .filter(([label, value]) => {
            const num = parseFloat(value);
            return sumLabels.has(label) && !isNaN(num);
        })
        .map(async ([label, value]) => {
            const numValue = parseFloat(value);
            const priceKey = `Precio: ${label}`;
            const pricePerBulto = productionData[priceKey] ? parseInt(productionData[priceKey]) : 0;
            const pricePerKg = productionData[`Precio KG: ${label}`] ? parseInt(productionData[`Precio KG: ${label}`]) : 0;
            const bultos = parseInt(productionData[`Bultos: ${label}`] || 0);

            // Construir el objeto de precios para la columna sale_price
            const salePriceObject = {};
            if (pricePerBulto > 0) salePriceObject['Bulto'] = pricePerBulto;
            if (pricePerKg > 0) salePriceObject['KG'] = pricePerKg;

            // Crear o actualizar producto de producción en tabla products
            let prodCode = (await generateNextInventoryCode())[0];
            const { data: existingProd, error: existingError } = await _supabase
                .from('products')
                .select('base_code, sale_price')
                .eq('name', label).eq('inventory', false) // Buscar en productos base
                .maybeSingle();
            
            if (existingProd) { // Si ya existe una definición, la usamos
                prodCode = existingProd.base_code;
                // Si hay precios nuevos, actualizar el JSONB
                if (Object.keys(salePriceObject).length > 0) {
                    await _supabase.from('products')
                        .update({ sale_price: salePriceObject })
                        .eq('base_code', existingProd.base_code);
                }
            } else { // Si no existe, creamos una nueva definición de producto
                await _supabase.from('products').insert({
                    base_code: prodCode,
                    name: label,
                    unit: 0,
                    medit: ['Bulto', 'KG'], // Medidas para subproductos
                    weigth: { 'Bulto': 0, 'KG': 0 }, // Inicializar weigth
                    sale_price: salePriceObject,
                    buy_price: null, // No aplica precio de compra
                    total: 0,
                    animal: false,
                    to_sale: true, // Para venta por defecto
                    inventory: false // Es una definición
                });
            }
            
            const { data: existingFieldInv, error: existingFieldError } = await _supabase
                .from('products')
                .select('id, unit, weigth')
                .eq('name', label)
                .eq('farm', farm)
                .eq('inventory', true)
                .maybeSingle();

            if (existingFieldError) {
                console.error(`Error consultando inventario animal para campo ${label}:`, existingFieldError.message);
            } else if (!existingFieldInv) {
                const invCode = inventoryCodes.shift(); // Tomar el siguiente código secuencial
                if (!invCode) return; // Seguridad por si algo falla

                const { error: invInsertError } = await _supabase.from('products').insert({
                    base_code: prodCode,
                    inventory_code: invCode,
                    name: label,
                    unit: bultos, // La unidad principal son los bultos
                    weigth: { 'Bulto': bultos, 'KG': numValue }, // JSON con ambas medidas
                    sale_price: salePriceObject, // Guardar el objeto de precios en el item de inventario
                    farm: farm,
                    provider: [],
                    medit: ['Bulto', 'KG'],
                    inventory: true,
                    created_at: getColombiaTimestamp()
                });
                if (invInsertError) console.error(`Error creando inventario animal para campo ${label}:`, invInsertError.message);
            } else {
                const newAmount = (existingFieldInv.unit || 0) + bultos;
                const newWeight = (existingFieldInv.weigth?.KG || 0) + numValue;
                const { error: invUpdateError } = await _supabase.from('products')
                    .update({ unit: newAmount, weigth: { ...existingFieldInv.weigth, 'Bulto': newAmount, 'KG': newWeight }, sale_price: salePriceObject })
                    .eq('id', existingFieldInv.id);
                if (invUpdateError) console.error(`Error actualizando inventario animal para campo ${label}:`, invUpdateError.message);
            }
        });

    await Promise.all(invOps);

    // --- Actualizar stock del animal base ---
    const { data: baseAnimal, error: baseAnimalError } = await _supabase
        .from('products')
        .select('unit, weigth')
        .eq('base_code', productCode)
        .eq('inventory', false)
        .single();

    if (!baseAnimalError && baseAnimal) {
        const newUnits = (baseAnimal.unit || 0) - units;
        const newWeightKG = (baseAnimal.weigth?.KG || 0) - initialWeight;
        
        // Construir el nuevo objeto weigth preservando los datos existentes
        const newWeigthObject = {
            ...(baseAnimal.weigth || {}), // Copiar datos existentes (ej: Bultos)
            'KG': Math.max(0, newWeightKG) // Actualizar solo el valor de KG
        };

        await _supabase
            .from('products')
            .update({ unit: Math.max(0, newUnits), weigth: newWeigthObject })
            .eq('base_code', productCode)
            .eq('inventory', false);
    }
    // Crear movimiento general del ingreso de animal
    const { data: mvData, error: mvError } = await _supabase.from('movements').insert([{
        name: productName,
        type: isEdit ? "edicion_ingreso_animal" : "ingreso_animal",
        amount: units,
        farm: farm,
        medit: "KG",
        shed: String(shedNumber),
        description: `Ingreso procesado en Galpón ${shedNumber}. Campos dinámicos validados de producción.`,
        production_data: productionData,
        created_at: getColombiaTimestamp()
    }]).select('id').single();

    if (mvError) console.warn('Warning: movimiento no creado:', mvError.message);

    // Crear movimientos individuales por cada campo de tipo 'sum'
    const moveOps = Object.entries(productionData)
        .filter(([label, value]) => {
            const num = parseFloat(value);
            return sumLabels.has(label) && !isNaN(num) && num !== 0;
        })
        .map(async ([label, value]) => {
            const numValue = parseFloat(value);
            const bultosKey = `Bultos: ${label}`;
            const bultos = productionData[bultosKey] ? parseInt(productionData[bultosKey]) : 0;
            const desc = bultos > 0
                ? `Ingreso de ${label}: ${numValue} KG (${bultos} bultos) en Galpón ${shedNumber}`
                : `Ingreso de ${label}: ${numValue} KG en Galpón ${shedNumber}`;

            await _supabase.from('movements').insert({
                name: label,
                type: isEdit ? "edicion_ingreso_animal" : "ingreso_animal",
                amount: numValue,
                farm: farm,
                medit: "KG",
                shed: String(shedNumber),
                description: desc,
                production_data: { [label]: numValue, ...(bultos > 0 ? { bultos } : {}) },
                created_at: getColombiaTimestamp()
            });
        });

    await Promise.all(moveOps);

    showToast(isEdit ? "Registro actualizado" : "Animales ingresados al galpón correctamente");
    closeModals();
    if (window.CURRENT_VIEW_MODE === 'sheds') renderInventoryView('sheds');
});

// Ingeniería de Backend: Procesamiento de la Salida de Animales del Galpón
document.getElementById('formOutboundAnimal')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;

    const productName = document.getElementById('outboundAnimalProduct').value;
    const productCode = document.getElementById('outboundAnimalProduct').options[document.getElementById('outboundAnimalProduct').selectedIndex].dataset.baseCode;
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
    // Incluir precios dinámicos por campo de tipo 'sum'
    document.querySelectorAll('#dynamicProductionFieldsOut .price-dynamic-input').forEach(priceInput => {
        const priceValue = parseInt(priceInput.value.replace(/\D/g, '')) || 0;
        if (priceValue > 0) {
            productionData[`Precio: ${priceInput.dataset.label}`] = priceValue;
        }
    });
    // FASE 13: Incluir precios por KG en salida
    document.querySelectorAll('#dynamicProductionFieldsOut .price-kg-dynamic-input').forEach(priceInput => {
        const priceValue = parseInt(priceInput.value.replace(/\D/g, '')) || 0;
        if (priceValue > 0) {
            productionData[`Precio KG: ${priceInput.dataset.label}`] = priceValue;
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
    // Separar precios dinámicos de los datos de producción
    let priceDynamicOut = {};
    Object.entries(productionData).forEach(([key, value]) => {
        if (key.startsWith('Precio: ')) {
            const fieldName = key.replace('Precio: ', '');
            priceDynamicOut[`${fieldName} bulto`] = value;
        }
        // FASE 13: Añadir precios por KG al objeto price_dynamic en salida
        if (key.startsWith('Precio KG: ')) {
            const fieldName = key.replace('Precio KG: ', '');
            priceDynamicOut[`${fieldName}_KG`] = value;
        }
    });

    const { data: outRec, error: outRecErr } = await _supabase.from('animal_production_records').insert({
        batch_id: batch.id,
        event_type: 'salida',
        units: units,
        initial_weight: baseWeight,
        dynamic_data: productionData,
        price_dynamic: Object.keys(priceDynamicOut).length > 0 ? priceDynamicOut : null
    }).select('id').single();

    if (outRecErr) return showToast("Error guardando registro de salida: " + outRecErr.message, "error");

    // --- Actualizar inventario de animales ---
    // Restar de cada registro individual en inventory por cada campo de productionData que tenga operation='sum' en config
    const isMarinado = document.getElementById('outboundAnimalMarinated')?.checked || false;
    
    const invOpsOut = Object.entries(productionData)
        .filter(([label, value]) => {
            const num = parseFloat(value);
            return sumLabelsOut.has(label) && !isNaN(num) && num !== 0;
        })
        .map(async ([label, value]) => {
            const numValue = parseFloat(value);
            const priceKey = `Precio: ${label}`;
            const pricePerBulto = productionData[priceKey] ? parseInt(productionData[priceKey]) : 0;
            const pricePerKg = productionData[`Precio KG: ${label}`] ? parseInt(productionData[`Precio KG: ${label}`]) : 0;
            const bultosKey = `Bultos: ${label}`;
            const bultos = productionData[bultosKey] ? parseInt(productionData[bultosKey]) : 0;

            const salePriceObject = {};
            if (pricePerBulto > 0) salePriceObject['Bulto'] = pricePerBulto;
            if (pricePerKg > 0) salePriceObject['KG'] = pricePerKg;
            
            // Actualizar precio del producto de producción
            if (Object.keys(salePriceObject).length > 0) {
                await _supabase.from('products')
                    .update({ sale_price: salePriceObject })
                    .eq('name', label);
            }
            
            const { data: existingFieldInv, error: existingFieldError } = await _supabase
                .from('products')
                .select('id, unit, weigth')
                .eq('name', label)
                .eq('farm', farm)
                .eq('inventory', true)
                .maybeSingle();

            if (existingFieldError) {
                console.error(`Error consultando inventario animal para campo ${label}:`, existingFieldError.message);
            } else if (!existingFieldInv) {
                console.warn(`No existe inventario del campo ${label} en este galpón para registrar la salida.`);
            } else {
                const newAmount = Math.max(0, (existingFieldInv.unit || 0) - numValue);
                const newBulto = Math.max(0, (existingFieldInv.weigth?.Bulto || existingFieldInv.unit || 0) - bultos);
                const newKg = Math.max(0, (existingFieldInv.weigth?.KG || 0) - numValue);
                const { error: invUpdateError } = await _supabase.from('products')
                    .update({ unit: newAmount, weigth: { ...(existingFieldInv.weigth || {}), 'Bulto': newBulto, 'KG': newKg } })
                    .eq('id', existingFieldInv.id);
                if (invUpdateError) console.error(`Error actualizando inventario animal para campo ${label}:`, invUpdateError.message);
            }
        });

    await Promise.all(invOpsOut);

    // Si es marinado, crear nuevos items de inventario con el sufijo (marinado)
    if (isMarinado) {
        const marinadoLabels = Object.entries(productionData)
            .filter(([label, value]) => {
                const num = parseFloat(value);
                return sumLabelsOut.has(label) && !isNaN(num) && num !== 0;
            });
        
        const marinadoCodes = await generateNextInventoryCode(marinadoLabels.length);
        
        const marinadoOps = marinadoLabels.map(async ([label, value], idx) => {
            const numValue = parseFloat(value);
            const marinadoName = `${label} (marinado)`;
            const priceKey = `Precio: ${label}`;
            const pricePerBulto = productionData[priceKey] ? parseInt(productionData[priceKey]) : 0;
            const pricePerKg = productionData[`Precio KG: ${label}`] ? parseInt(productionData[`Precio KG: ${label}`]) : 0;
            const bultosKey = `Bultos: ${label}`;
            const bultos = productionData[bultosKey] ? parseInt(productionData[bultosKey]) : 0;

            const salePriceObject = {};
            if (pricePerBulto > 0) salePriceObject['Bulto'] = pricePerBulto;
            if (pricePerKg > 0) salePriceObject['KG'] = pricePerKg;
            
            // Buscar o crear definición de producto marinado
            const baseCode = marinadoCodes[idx];
            const { data: existingProd, error: existingError } = await _supabase
                .from('products')
                .select('base_code, sale_price')
                .eq('name', marinadoName).eq('inventory', false)
                .maybeSingle();
            
            if (existingProd) {
                if (Object.keys(salePriceObject).length > 0) {
                    await _supabase.from('products')
                        .update({ sale_price: salePriceObject })
                        .eq('base_code', existingProd.base_code);
                }
            } else {
                await _supabase.from('products').insert({
                    base_code: baseCode,
                    name: marinadoName,
                    unit: 0,
                    medit: ['Bulto', 'KG'],
                    weigth: { 'Bulto': 0, 'KG': 0 },
                    sale_price: salePriceObject,
                    buy_price: null,
                    total: 0,
                    animal: false,
                    to_sale: true,
                    inventory: false
                });
            }
            
            // Crear item de inventario marinado
            const invCode = (await generateNextInventoryCode())[0];
            await _supabase.from('products').insert({
                base_code: existingProd ? existingProd.base_code : baseCode,
                inventory_code: invCode,
                name: marinadoName,
                unit: bultos,
                weigth: { 'Bulto': bultos, 'KG': numValue },
                sale_price: salePriceObject,
                farm: farm,
                provider: [],
                medit: ['Bulto', 'KG'],
                inventory: true,
                created_at: getColombiaTimestamp()
            });
        });
        
        await Promise.all(marinadoOps);
    }

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

    // Crear movimiento general de la salida
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

    // Crear movimientos individuales por cada campo de tipo 'sum'
    const moveOpsOut = Object.entries(productionData)
        .filter(([label, value]) => {
            const num = parseFloat(value);
            return sumLabelsOut.has(label) && !isNaN(num) && num !== 0;
        })
        .map(async ([label, value]) => {
            const numValue = parseFloat(value);
            const bultosKey = `Bultos: ${label}`;
            const bultos = productionData[bultosKey] ? parseInt(productionData[bultosKey]) : 0;
            const desc = bultos > 0
                ? `Salida de ${label}: ${numValue} KG (${bultos} bultos) en Galpón ${shedNumber}`
                : `Salida de ${label}: ${numValue} KG en Galpón ${shedNumber}`;

            await _supabase.from('movements').insert({
                name: label,
                type: 'salida_animal',
                amount: numValue,
                farm: farm,
                medit: 'KG',
                shed: String(shedNumber),
                description: desc,
                production_data: { [label]: numValue, ...(bultos > 0 ? { bultos } : {}) },
                created_at: getColombiaTimestamp()
            });
        });

    await Promise.all(moveOpsOut);

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
    if (window.CURRENT_VIEW_MODE === 'sheds') renderInventoryView('sheds');
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
    let query = _supabase.from('products').select('*').eq('inventory', true);
    if (!isNaN(idOrProduct) && !String(idOrProduct).includes(':')) query = query.eq('id', idOrProduct);
    else query = query.eq('name', idOrProduct);

    const { data: inv, error } = await query.single();
    if (error || !inv) return showToast("Error al cargar datos", "error");

    const form = document.getElementById('formEditInventory');
    form.dataset.mode = 'edit';
    form.dataset.id = inv.id;
    form.dataset.oldAmount = inv.unit;
    form.dataset.oldProduct = inv.name;
    form.dataset.oldFarm = inv.farm;
    form.dataset.oldShed = ""; // Shed is no longer relevant for product inventory
    form.dataset.currentProv = Array.isArray(inv.provider) ? inv.provider[0] : inv.provider;
    form.dataset.currentShed = inv.shed || "";

    // Cargar selectores
    const { data: prods } = await _supabase.from('products').select('name, medit, code, unit').order('name'); // Ya no se selecciona 'categorie'
    const prodSelect = document.getElementById('editInvProductSelect');
    prodSelect.innerHTML = prods.map(p => `<option value="${p.name}" data-medit="${p.medit}" data-code="${p.code}" data-global="${p.unit}">${p.name}</option>`).join(''); // Ya no se usa data-cat
    prodSelect.value = inv.name;

    const { data: farms } = await _supabase.from('farms').select('name').order('name');
    const farmSelect = document.getElementById('editInvFarmSelect');
    farmSelect.innerHTML = farms.map(f => `<option value="${f.name}">${f.name}</option>`).join('');
    farmSelect.value = inv.farm;

    document.getElementById('editInvAmountInput').value = inv.unit;

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

    const { error } = await _supabase.from('products').update({ // Update inventory item
        base_code: prodOpt.dataset.code, name: newProduct, farm: newFarm,
        unit: newAmount, provider: newProvider ? [newProvider] : [], medit: prodOpt.dataset.medit
    }).eq('id', id);

    if (error) showToast("Error: " + error.message, "error");
    else { showToast("Registro actualizado y sincronizado"); closeModals(); loadFilteredInventory(window.CURRENT_INVENTORY_MODE); }
});

window.deleteInventoryItem = async (idOrProduct) => {
    if (!confirm("¿Desea eliminar este registro del inventario?")) return;
    
    // Ingeniería de Sistemas: Manejo polimórfico de eliminación para evitar errores de tipo en DB
    let query = _supabase.from('products').delete().eq('inventory', true);
    
    if (!isNaN(idOrProduct) && !String(idOrProduct).includes(':')) {
        query = query.eq('id', idOrProduct);
    } else {
        query = query.eq('name', idOrProduct);
    }

    const { error } = await query;
    if (error) showToast("Error: " + error.message, "error");
    else { showToast("Registro eliminado"); loadFilteredInventory(window.CURRENT_VIEW_MODE); }
};

window.editInventoryItem = async (inventoryId) => {
    const { data: inv, error } = await _supabase.from('products').select('*').eq('id', inventoryId).single();
    if (error || !inv) return showToast("Error al cargar datos del inventario", "error");

    const form = document.getElementById('formEditInventory');
    form.dataset.mode = 'edit';
    form.dataset.id = inv.id;
    form.dataset.oldAmount = inv.unit;
    form.dataset.oldProduct = inv.name;
    form.dataset.oldFarm = inv.farm;
    form.dataset.currentProv = Array.isArray(inv.provider) ? inv.provider[0] : inv.provider;

    // Cargar selectores
    const { data: prods } = await _supabase.from('products').select('name, medit, base_code, unit').eq('inventory', false).order('name');
    const prodSelect = document.getElementById('editInvProductSelect');
    prodSelect.innerHTML = prods.map(p => `<option value="${p.name}" data-medit="${p.medit}" data-code="${p.base_code}" data-global="${p.unit}">${p.name}</option>`).join('');
    prodSelect.value = inv.name;

    const { data: farms } = await _supabase.from('farms').select('name').order('name');
    const farmSelect = document.getElementById('editInvFarmSelect');
    farmSelect.innerHTML = farms.map(f => `<option value="${f.name}">${f.name}</option>`).join('');
    farmSelect.value = inv.farm;

    document.getElementById('editInvAmountInput').value = inv.unit;

    // Disparar eventos para poblar campos secundarios y calcular proyección inicial
    prodSelect.dispatchEvent(new Event('change'));

    showModal('modalEditInventory');
};

document.getElementById('formEditInventory')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const id = form.dataset.id;
    const oldAmount = parseFloat(form.dataset.oldAmount);
    const oldProduct = form.dataset.oldProduct;

    const newProductName = document.getElementById('editInvProductSelect').value;
    const newFarm = document.getElementById('editInvFarmSelect').value;
    const newAmount = parseFloat(document.getElementById('editInvAmountInput').value);
    const newProvider = document.getElementById('editInvProviderSelect').value;
    const prodOpt = document.getElementById('editInvProductSelect').options[document.getElementById('editInvProductSelect').selectedIndex];

    // Actualizar el registro de inventario
    const { error } = await _supabase.from('products').update({
        name: newProductName,
        farm: newFarm,
        unit: newAmount,
        provider: newProvider ? [newProvider] : [],
        medit: prodOpt.dataset.medit
    }).eq('id', id);

    if (error) showToast("Error al actualizar: " + error.message, "error");
    else { 
        showToast("Registro de inventario actualizado"); 
        closeModals(); 
        loadFilteredInventory('products');
    }
});

window.deleteProduct = async (base_code) => {
    if (!confirm(`¿Está seguro de eliminar la definición del producto con código ${base_code}?`)) return;
    const { error } = await _supabase.from('products').delete().eq('base_code', base_code);
    if (error) {
        showToast("Error al eliminar producto: " + error.message, "error");
    } else {
        showToast("Definición de producto eliminada.");
        renderBaseProducts(); // Refrescar la lista de productos base
    }
};

// ==========================================================
// SECCIÓN DE ESTADÍSTICAS DE PRODUCCIÓN
// ==========================================================

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
    document.getElementById('inboundCategory').textContent = "---";

    // Carga inicial de productos (excluyendo categorías de animales)
    let { data: prods } = await _supabase.from('products').select('name, unit, medit, code').order('name');
    // Ya no se filtra por categorías de animales aquí, ya que los productos no tienen categoría

    prodSelect.innerHTML = '<option value="" disabled selected hidden>Seleccione producto...</option>' + 
        // Ahora pasamos 'unit' (valor) y 'medit' (medida)
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

    document.getElementById('inboundCategory').textContent = "N/A"; // Ya no hay categoría para mostrar
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
            unit: unit,
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
        document.getElementById('inboundCategory').textContent = "---";
        
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

    const { data: productsInfo } = await _supabase.from('products').select('name, medit, unit').order('name'); // All product info

    const meditMap = Object.fromEntries((productsInfo || []).map(p => [p.name, p.medit]));
    const unitMap = Object.fromEntries((productsInfo || []).map(p => [p.name, p.unit])); // Factor de conversión
    const uniqueInvNames = [...new Set((invItems || []).map(i => i.product))];

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
    // El filtro por categoría de animales se ha eliminado ya que los productos no tienen categorías
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
                        <td>${formatNumber(item.amount)}</td>
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

    inboundTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 15px; color: #b2bec3;">No hay entradas registradas</td></tr>';
    outboundTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 15px; color: #b2bec3;">No hay salidas registradas</td></tr>';

    // Mostrar el modal
    showModal('modalManageShedAnimals');
};

// --- Lógica de Ingreso de Animales ---

async function prepareInboundAnimalModal() {
    const select = document.getElementById('inboundAnimalProduct');
    const container = document.getElementById('dynamicFieldsContainer');
    const trigger = document.getElementById('chkAddCustomField');
    const form = document.getElementById('formInboundAnimal');
    
    // Reiniciar formulario
    form.reset();
    delete form.dataset.mode;
    delete form.dataset.oldUnits;
    delete form.dataset.oldWeight;

    container.innerHTML = "";
    trigger.checked = false;
    document.getElementById('nextFieldTrigger').classList.remove('hidden');
    document.getElementById('animalStockDisplay').classList.add('hidden');
    document.getElementById('inboundAnimalTotalWeight').textContent = "0";

    // Ingeniería de Datos: Consultar productos marcados como animales
    const { data: animals, error } = await _supabase
        .from('products')
        .select('name, unit, weigth')
        .eq('animal', true)
        .order('name');

    if (error) {
        console.error("Error al cargar animales:", error);
        showToast("Error al cargar animales", "error");
    }

    select.innerHTML = '<option value="" disabled selected hidden>Seleccione animal...</option>' +
        (animals || []).map(a => `<option value="${a.name}" data-unit="${a.unit}" data-weight="${a.weigth || 0}">${a.name}</option>`).join('');

    // Listeners de tiempo real
    const updateDisplay = () => calculateAnimalInboundTotals();
    document.getElementById('inboundAnimalUnitsQty').oninput = updateDisplay;
    document.getElementById('inboundAnimalWeightQty').oninput = updateDisplay;
    select.onchange = updateDisplay;

    // Manejo de campos infinitos
    trigger.onclick = function() {
        if (this.checked) {
            addInboundCustomField();
            this.closest('#nextFieldTrigger').classList.add('hidden'); // Ocultar el trigger actual
        }
    };
}

function addInboundCustomField() {
    const container = document.getElementById('dynamicFieldsContainer');
    const fieldId = Date.now();
    
    const fieldGroup = document.createElement('div');
    fieldGroup.className = 'custom-field-group';
    fieldGroup.style = "margin-bottom: 10px; border-left: 3px solid #0984e3; padding-left: 10px;";
    fieldGroup.innerHTML = `
        <div style="display: flex; gap: 10px; margin-bottom: 8px; align-items: center;">
            <input type="text" placeholder="Nombre" class="custom-field-name" style="margin:0; flex: 2;">
            <input type="number" placeholder="KG" class="custom-field-value" style="margin:0; flex: 1;" step="any">
            <button type="button" class="btn-cancel" style="width: auto; padding: 5px 10px; margin:0; height: 38px;" onclick="removeInboundCustomField(this)">×</button>
        </div>
        <div class="next-trigger" style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="chk_${fieldId}" style="width: auto; margin: 0;">
            <label for="chk_${fieldId}" style="margin: 0; font-size: 12px; color: #636e72; cursor: pointer;">Agregar campo de producción</label>
        </div>
    `;

    container.appendChild(fieldGroup);

    // Listener para el valor numérico
    fieldGroup.querySelector('.custom-field-value').oninput = calculateAnimalInboundTotals;

    // Listener para el nuevo checkbox "infinito"
    fieldGroup.querySelector('input[type="checkbox"]').onclick = function() {
        if (this.checked) {
            addInboundCustomField();
            this.closest('.next-trigger').classList.add('hidden');
        }
    };
}

// Función para eliminar campos y restaurar visibilidad de disparadores
window.removeInboundCustomField = (btn) => {
    const group = btn.closest('.custom-field-group');
    group.remove();
    calculateAnimalInboundTotals();

    const container = document.getElementById('dynamicFieldsContainer');
    const groups = container.querySelectorAll('.custom-field-group');

    if (groups.length === 0) {
        // Si no quedan campos, mostrar el disparador principal
        document.getElementById('nextFieldTrigger').classList.remove('hidden');
        document.getElementById('chkAddCustomField').checked = false;
    } else {
        // Si quedan campos, mostrar el disparador del último grupo actual
        groups[groups.length - 1].querySelector('.next-trigger').classList.remove('hidden');
        groups[groups.length - 1].querySelector('input[type="checkbox"]').checked = false;
    }
};

function calculateAnimalInboundTotals() {
    const select = document.getElementById('inboundAnimalProduct');
    const selected = select.options[select.selectedIndex];
    if (!selected || selected.disabled) return;

    // Datos base del producto
    const stockUnits = parseFloat(selected.dataset.unit) || 0;
    const stockWeight = parseFloat(selected.dataset.weight) || 0;

    // Entradas del formulario
    const inputUnits = parseFloat(document.getElementById('inboundAnimalUnitsQty').value) || 0;
    const initialWeight = parseFloat(document.getElementById('inboundAnimalWeightQty').value) || 0;

    const form = document.getElementById('formInboundAnimal');
    const isEdit = form.dataset.mode === 'edit';
    const oldUnits = isEdit ? parseFloat(form.dataset.oldUnits) || 0 : 0;
    const oldWeight = isEdit ? parseFloat(form.dataset.oldWeight) || 0 : 0;

    // Sumar campos dinámicos
    let dynamicWeight = 0;
    document.querySelectorAll('.custom-field-value').forEach(input => {
        dynamicWeight += parseFloat(input.value) || 0;
    });

    const totalWeight = dynamicWeight;
    const merma = initialWeight - totalWeight;

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

    // Actualizar total general
    document.getElementById('inboundAnimalTotalWeight').textContent = formatNumber(totalWeight);

    // Actualizar Merma
    const mermaElement = document.getElementById('inboundAnimalMerma');
    mermaElement.textContent = formatNumber(merma);
    mermaElement.style.color = merma < 0 ? '#ff7675' : '#fab1a0';
}

// Ingeniería de Backend: Procesamiento del Ingreso de Animales al Galpón
document.getElementById('formInboundAnimal')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const isEdit = form.dataset.mode === 'edit';
    
    const productName = document.getElementById('inboundAnimalProduct').value;
    const units = parseFloat(document.getElementById('inboundAnimalUnitsQty').value) || 0;
    const initialWeight = parseFloat(document.getElementById('inboundAnimalWeightQty').value) || 0;

    // Re-calcular dinámicos para el envío
    let dynamicWeight = 0;
    document.querySelectorAll('.custom-field-value').forEach(input => {
        dynamicWeight += parseFloat(input.value) || 0;
    });
    const totalWeight = dynamicWeight;
    const merma = initialWeight - totalWeight;

    const modalManage = document.getElementById('modalManageShedAnimals');
    const farm = modalManage.dataset.farm;
    const shedNumber = modalManage.dataset.number;

    if (!productName) return showToast("Seleccione un animal", "error");

    // 1. Actualizar Stock Maestro (Tabla Products)
    const { data: prodData } = await _supabase.from('products').select('unit, weigth').eq('name', productName).single();
    if (!prodData) return showToast("Error al obtener datos del animal", "error");

    let diffUnits = units;
    let diffWeight = initialWeight;

    if (isEdit) {
        const oldUnits = parseFloat(form.dataset.oldUnits) || 0;
        const oldWeight = parseFloat(form.dataset.oldWeight) || 0;
        diffUnits = units - oldUnits;
        diffWeight = initialWeight - oldWeight;
    }

    const newGlobalUnits = (prodData.unit || 0) - diffUnits;
    const newGlobalWeight = (prodData.weigth || 0) - diffWeight;

    const { error: prodErr } = await _supabase
        .from('products')
        .update({ unit: newGlobalUnits, weigth: newGlobalWeight })
        .eq('name', productName);

    if (prodErr) return showToast("Error al actualizar stock global: " + prodErr.message, "error");

    // 2. Actualizar Ocupación del Galpón
    await updateShedUsage(farm, parseInt(shedNumber), diffUnits, true);

    // 3. Registrar Movimiento Histórico
    await _supabase.from('movements').insert([{
        name: productName,
        type: isEdit ? "edicion_ingreso_animal" : "ingreso_animal",
        amount: units,
        farm: farm,
        medit: "KG",
        shed: String(shedNumber),
        description: `Ingreso a Galpón ${shedNumber}. Merma: ${merma} KG.`,
        created_at: getColombiaTimestamp()
    }]);

    showToast(isEdit ? "Registro actualizado" : "Animales ingresados al galpón correctamente");
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
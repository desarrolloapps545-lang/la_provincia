// Ingeniería de Backend: Conexión con Supabase para Facturación
const SUPABASE_URL = "https://zvxnksnsovtlczausrvl.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2eG5rc25zb3Z0bGN6YXVzcnZsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY3Nzc0NSwiZXhwIjoyMDkxMjUzNzQ1fQ.ai6JYAE43_HCmIXTR6McoTHkEi0wYuMszqCQn-pMhaA";
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let franchiseData = null;
let currentFacturasType = 'ventas';

// Ingeniería de Frontend: Helper para Toasts
const showToast = (message, type = 'success') => {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast`;
    toast.style.backgroundColor = type === 'error' ? '#d63031' : '#00b894';
    toast.style.color = 'white';
    toast.style.padding = '12px 25px';
    toast.style.borderRadius = '8px';
    toast.style.marginTop = '10px';
    toast.style.boxShadow = '0 5px 15px rgba(0,0,0,0.2)';
    toast.style.fontSize = '14px';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
};

// Ingeniería de Frontend: Helper para formateo de millares con puntos (.)
const formatNumber = (num) => {
    if (num === null || num === undefined) return "0";
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

// Ingeniería de Backend en Frontend: Helper para obtener fecha/hora de Colombia
const getColombiaTimestamp = () => {
    const now = new Date();
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const time = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    }).format(now);
    return `${date} ${time}`;
};

// Helper para limpiar fechas de base de datos a formato 12h para visualización
const format12h = (dateStr) => {
    if (!dateStr) return "";
    let clean = dateStr.replace('T', ' ').split('.')[0];
    if (clean.includes('AM') || clean.includes('PM')) return clean;

    const date = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T'));
    if (isNaN(date.getTime())) return clean;

    const d = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    const t = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(date);
    return `${d} ${t}`;
};

// Ingeniería de Sistemas: Helper para normalización de texto
const normalizeText = (str) => {
    if (str === null || str === undefined) return "";
    return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
};

// Control de Navegación del Workspace
function switchView(viewId) {
    document.getElementById('welcomeFacturacion').classList.add('hidden');
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
}

document.getElementById('btnClientes')?.addEventListener('click', () => {
    switchView('clientesView');
    loadClients('persona'); // Por defecto, mostrar clientes tipo 'persona'
});

document.getElementById('btnPersonas')?.addEventListener('click', () => loadClients('persona'));
document.getElementById('btnNegocios')?.addEventListener('click', () => loadClients('negocio'));

async function loadClients(type) {
    switchView('clientesView');
    const container = document.getElementById('clientesTableContainer');
    container.innerHTML = "<p style='padding:20px;'>Cargando clientes...</p>";

    let query = _supabase.from('clients').select('name, phone, cedula, nit, address, email').order('name');

    // Ingeniería de Datos: Filtrado técnico por presencia de identificador
    if (type === 'persona') {
        query = query.not('cedula', 'is', null).gt('cedula', 0);
    } else {
        query = query.not('nit', 'is', null).gt('nit', 0);
    }

    const { data, error } = await query;

    if (error) {
        console.error("Error al obtener clientes:", error);
        showToast("Error al cargar datos", "error");
        renderClientsTable([], type); // Mostrar tabla con encabezados y mensaje de error
    }

    renderClientsTable(data, type);
}

function renderClientsTable(data, type) {
    const container = document.getElementById('clientesTableContainer');
    
    const isPersona = type === 'persona';
    
    const html = `
        <table>
            <thead>
                <tr>
                    <th>${isPersona ? 'Nombre' : 'Razon Social'}</th>
                    <th>Celular</th>
                    <th>${isPersona ? 'Cedula' : 'Nit'}</th>
                    <th>Direccion</th>
                    <th>Correo</th>
                </tr>
            </thead>
            <tbody>
                ${data && data.length > 0 
                    ? data.map(c => `
                        <tr>
                            <td>${c.name || 'N/A'}</td>
                            <td>${c.phone || 'N/A'}</td>
                            <td>${isPersona ? (c.cedula || 'N/A') : (c.nit || 'N/A')}</td>
                            <td>${c.address || 'N/A'}</td>
                            <td>${c.email || 'N/A'}</td>
                        </tr>
                    `).join('') 
                    : `<tr><td colspan="5" style="text-align:center; padding: 20px;">No hay datos para mostrar en este momento</td></tr>`
                }
            </tbody>
        </table>`;
    
    container.innerHTML = html;
}

// FASE 9.4: Lógica de Ventas Split View
let selectedFarm = null;
let selectedEntity = null; // Puede ser Cliente o Proveedor
let inventoryData = [];
let cart = [];
let productPendingToCart = null;
let selectedProviders = []; // Corregido: Definición global de proveedores
let currentSalesStep = 0; // Para persistencia de navegación
let billingMode = 'venta'; // 'venta' o 'compra'

document.getElementById('btnFacturacion')?.addEventListener('click', () => {
    switchView('ventasView');
    // Ingeniería de Sistemas: Solo reiniciamos si no hay un proceso iniciado (Step 0)
    if (currentSalesStep === 0) {
        initSalesProcess();
    }
});

function setBillingMode(mode) {
    billingMode = mode;
    // Actualizar UI
    const isVenta = mode === 'venta';
    document.getElementById('step1Title').textContent = isVenta ? 'Identificación del Cliente' : 'Identificación del Proveedor';
    document.getElementById('searchEntityLabel').textContent = isVenta ? 'Buscar Cliente Registrado:' : 'Buscar Proveedor Registrado:';
    document.getElementById('newEntityLabel').classList.toggle('hidden', !isVenta);
    document.getElementById('newClientButtons').classList.toggle('hidden', !isVenta);
    document.getElementById('newSupplierButtons').classList.toggle('hidden', isVenta);
    document.getElementById('newProductPurchaseButton').classList.toggle('hidden', isVenta);
    document.getElementById('rightPanelTitle').textContent = isVenta ? 'Detalle de la Venta' : 'Detalle de la Compra';
    document.getElementById('btnBackStep1').textContent = isVenta ? 'Cambiar Cliente' : 'Cambiar Proveedor';
    document.getElementById('cashReceivedLabel').textContent = isVenta ? 'Efectivo Recibido:' : 'Efectivo Entregado:';
    document.getElementById('saleReceivedRowLabel').textContent = isVenta ? 'Monto recibido:' : 'Monto entregado:';
    document.getElementById('btnLiquidarVenta').textContent = isVenta ? 'Liquidar Venta' : 'Liquidar Compra';
    
    // Ingeniería de Sistemas: Limpieza absoluta de estados, formularios y UI al cambiar de modo
    cart = [];
    selectedProviders = [];
    selectedEntity = null;
    selectedFarm = null; // Asegurar que la granja también se reinicie

    // Resetear elementos UI que podrían persistir visualmente
    document.getElementById('salesFarmSelect').value = ""; // Asegurar que el select de granja esté vacío
    const farmBadge = document.getElementById('saleFarmBadge');
    farmBadge.textContent = "Granja: No seleccionada";
    farmBadge.classList.toggle('hidden', !isVenta); // Permanente en modo venta, oculto en compra

    document.getElementById('selectedEntityBadge').classList.add('hidden');
    document.getElementById('searchExistingEntity').value = "";
    document.getElementById('searchProductSales').value = "";
    document.getElementById('newClientSaleForm')?.reset();

    updateCartUI();
    updateSelectedProvidersUI();
    initSalesProcess();
}

async function initSalesProcess() {
    if (billingMode === 'venta') {
        await loadFarmsForSales();
        backToStep0();
    } else {
        selectedFarm = null;
        goToStep1(); // Compras salta el paso de granja
    }
}

async function loadFarmsForSales() {
    const farmSelect = document.getElementById('salesFarmSelect');
    const { data, error } = await _supabase.from('farms').select('name').order('name');
    if (!error && data) {
        farmSelect.innerHTML = '<option value="" disabled selected hidden>Seleccione granja...</option>' + 
            data.map(f => `<option value="${f.name}">${f.name}</option>`).join('');
    }
}

function backToStep0() {
    selectedFarm = null;
    selectedEntity = null;
    selectedProviders = [];
    cart = [];
    currentSalesStep = 0;

    // Limpiar formularios y búsquedas
    document.getElementById('searchExistingEntity').value = "";
    document.getElementById('searchProductSales').value = "";
    document.getElementById('newClientSaleForm')?.classList.add('hidden');
    document.getElementById('newClientSaleForm')?.reset();

    document.getElementById('salesStep0').classList.remove('hidden');
    document.getElementById('salesStep1').classList.add('hidden');
    document.getElementById('salesStep2').classList.add('hidden');
    document.getElementById('salesStep3').classList.add('hidden');
    document.getElementById('salesFarmSelect').value = "";
    document.getElementById('saleFarmBadge').textContent = "Granja: No seleccionada";
    document.getElementById('saleFarmBadge').classList.remove('hidden');
    document.getElementById('paymentMethodBadge').classList.add('hidden');
    document.getElementById('saleReceivedRow').classList.add('hidden');
    document.getElementById('saleChangeRow').classList.add('hidden');
    document.getElementById('saleReceivedValue').textContent = "$ 0";
    document.getElementById('paymentMethod').value = "";
    updateSelectedProvidersUI();
    updateCartUI();
}

function goToStep1() {
    if (billingMode === 'venta') {
        const farmVal = document.getElementById('salesFarmSelect').value;
        if (!farmVal) return;
        selectedFarm = farmVal;
        document.getElementById('saleFarmBadge').textContent = `Granja: ${selectedFarm}`;
        document.getElementById('btnBackStep0').classList.remove('hidden');
        document.getElementById('saleFarmBadge').classList.remove('hidden');
    } else {
        selectedFarm = null;
        selectedEntity = null;
        selectedProviders = [];

        // Limpiar formularios para el inicio de Compras
        document.getElementById('searchExistingEntity').value = "";
        document.getElementById('searchProductSales').value = "";
        document.getElementById('newClientSaleForm')?.classList.add('hidden');
        document.getElementById('newClientSaleForm')?.reset();

        updateSelectedProvidersUI();

        document.getElementById('btnBackStep0').classList.add('hidden');
        document.getElementById('saleFarmBadge').classList.add('hidden');
    }

    currentSalesStep = 1;
    document.getElementById('salesStep0').classList.add('hidden');
    document.getElementById('salesStep1').classList.remove('hidden');
    document.getElementById('salesStep2').classList.add('hidden');
    document.getElementById('salesStep3').classList.add('hidden');
    loadInventoryForSales(); // Cargar inventario filtrado preventivamente
}

function backToStep1() {
    selectedEntity = null;
    // Nota: Mantenemos selectedProviders en compras para permitir edición
    cart = [];
    currentSalesStep = 1;

    // Limpiar formularios de productos y pago al retroceder a identificación
    document.getElementById('searchProductSales').value = "";
    document.getElementById('paymentMethod').value = "";
    document.getElementById('cashReceivedInput').value = "";

    document.getElementById('salesStep0').classList.add('hidden');
    document.getElementById('salesStep1').classList.remove('hidden');
    document.getElementById('salesStep2').classList.add('hidden');
    document.getElementById('salesStep3').classList.add('hidden');
    document.getElementById('newClientSaleForm')?.classList.add('hidden');
    document.getElementById('searchExistingEntity').value = "";
    
    const isVenta = (billingMode === 'venta');
    document.getElementById('btnBackStep0').classList.toggle('hidden', !isVenta);
    document.getElementById('saleFarmBadge').classList.toggle('hidden', !isVenta);

    updateCartUI();
}

async function goToStep2() {
    if (billingMode === 'compra' && selectedProviders.length === 0) {
        return showToast("Debe seleccionar al menos un proveedor", "error");
    }

    currentSalesStep = 2;
    document.getElementById('salesStep1').classList.add('hidden');
    document.getElementById('salesStep2').classList.remove('hidden');
    document.getElementById('salesStep3').classList.add('hidden');

    const badge = document.getElementById('selectedEntityBadge');
    if (billingMode === 'venta') {
        badge.textContent = `Facturar a: ${selectedEntity.name} (${selectedEntity.cedula || selectedEntity.nit})`;
    } else {
        badge.innerHTML = `Comprar a: <br>${selectedProviders.map(p => `<small>• ${p.name}</small>`).join('<br>')}`;
    }

    document.getElementById('paymentMethodBadge').classList.add('hidden');
    badge.classList.remove('hidden'); // Asegurar que el badge de entidad sea visible en Step 2
    await loadInventoryForSales();
}

function goToStep3() {
    currentSalesStep = 3;
    document.getElementById('salesStep2').classList.add('hidden');
    document.getElementById('salesStep3').classList.remove('hidden');
    document.getElementById('paymentMethodBadge').classList.remove('hidden');
    togglePaymentInputs();
}

function togglePaymentInputs() {
    const method = document.getElementById('paymentMethod').value;
    const cashGroup = document.getElementById('cashPaymentGroup');
    const badge = document.getElementById('paymentMethodBadge');
    const receivedRow = document.getElementById('saleReceivedRow');
    
    badge.textContent = `Pago: ${method}`;
    if (method === 'Efectivo') {
        cashGroup.classList.remove('hidden');
        document.getElementById('saleChangeRow').classList.remove('hidden');
        if (receivedRow) receivedRow.classList.remove('hidden');
    } else {
        cashGroup.classList.add('hidden');
        document.getElementById('saleChangeRow').classList.add('hidden');
        if (receivedRow) receivedRow.classList.add('hidden');
        document.getElementById('cashReceivedInput').value = "";
        document.getElementById('changeResult').textContent = "";
        document.getElementById('saleReceivedValue').textContent = "$ 0";
    }
}

async function loadInventoryForSales() {
    if (billingMode === 'venta' && !selectedFarm) return;

    // Ingeniería de Datos: Obtención de saldos físicos
    let inv = [];
    if (billingMode === 'venta') {
        const { data } = await _supabase
            .from('products')
            .select('inventory_code, name, unit, medit, weigth')
            .eq('farm', selectedFarm)
            .eq('inventory', true);
        // Mapeo manual para asegurar la estructura de datos correcta
        inv = (data || []).map(item => {
            const weigthValues = item.weigth && typeof item.weigth === 'object'
                ? Object.values(item.weigth).filter(v => typeof v === 'number')
                : [];
            const amount = Math.max(item.unit || 0, ...weigthValues);
            return {
                code: item.inventory_code,
                product: item.name,
                amount,
                medit: item.medit,
                weigth: item.weigth // Objeto con pesos detallados para visualización
            };
        }).filter(i => i.amount > 0);
    }

    // Obtención de información comercial de la tabla products
    const { data: prods, error: prodErr } = await _supabase
        .from('products')
        .select('name, sale_price, buy_price, base_code, medit, animal, to_sale, weigth');
    
    if (!prodErr) {
        const priceMap = Object.fromEntries(prods.map(p => [p.name, p.sale_price]));
        const buyPriceMap = Object.fromEntries(prods.map(p => [p.name, p.buy_price]));
        const animalSet = new Set(prods.filter(p => p.animal).map(p => p.name));
        const toSaleSet = new Set(prods.filter(p => p.to_sale !== false).map(p => p.name)); // Solo si to_sale es true o null

        if (billingMode === 'venta') {
            inventoryData = inv.map(i => ({
                ...i,
                sale_price: priceMap[i.product] || 0
            })).filter(i => !animalSet.has(i.product) && toSaleSet.has(i.product));
        } else {
            // Ingeniería de Sistemas: Filtrar productos por proveedores seleccionados
            // Un producto es válido si su nombre está en la lista de productos de al menos uno de los proveedores elegidos
            const allowedProductNames = new Set();
            selectedProviders.forEach(prov => {
                if (Array.isArray(prov.product)) {
                    prov.product.forEach(pName => allowedProductNames.add(normalizeText(pName)));
                }
            });

            inventoryData = prods
                .filter(p => p.animal !== true && p.to_sale !== false) // No animales, solo to_sale true/null
                .filter(p => allowedProductNames.has(normalizeText(p.name)))
                .map(p => ({
                    code: p.base_code,
                    product: p.name,
                    amount: 999999,
                    medit: p.medit,
                    sale_price: p.sale_price,
                    buy_price: p.buy_price,
                    weigth: p.weigth
                }));
        }
        
        if (!document.getElementById('salesStep2').classList.contains('hidden')) {
            renderInventorySales(inventoryData);
        }
    }
}

// Búsqueda de Clientes Existentes
async function performEntitySearch() {
    const val = document.getElementById('searchExistingEntity').value;
    const resultsDiv = document.getElementById('entitySearchResults');
    
    if (val.length < 2) {
        showToast("Ingrese al menos 2 caracteres para buscar", "error");
        resultsDiv.classList.add('hidden');
        return;
    }

    resultsDiv.innerHTML = '<div class="search-item">Buscando...</div>';
    resultsDiv.classList.remove('hidden');

    const isNumeric = !isNaN(val);
    const table = billingMode === 'venta' ? 'clients' : 'providers';
    
    let query = _supabase.from(table).select('*');
    if (billingMode === 'venta') {
        query = query.or(`name.ilike.%${val}%,cedula.eq.${isNumeric ? parseInt(val) : 0},nit.eq.${isNumeric ? parseInt(val) : 0}`);
    } else {
        query = query.or(`name.ilike.%${val}%,nit.eq.${isNumeric ? parseInt(val) : 0}`);
    }

    const { data } = await query.limit(5);

    if (data && data.length > 0) {
        resultsDiv.innerHTML = data.map(c => `
            <div class="search-item" onclick="selectEntityForSale(${JSON.stringify(c).replace(/"/g, '&quot;')})">
                <b>${c.name}</b><br><small>${c.cedula ? 'CC: ' + c.cedula : 'NIT: ' + c.nit}</small>
            </div>
        `).join('');
    } else {
        resultsDiv.innerHTML = '<div class="search-item">No se encontraron resultados</div>';
    }
}

document.getElementById('searchExistingEntity')?.addEventListener('input', (e) => {
    if (e.target.value.length >= 2) performEntitySearch();
    else document.getElementById('entitySearchResults').classList.add('hidden');
});

document.getElementById('btnSearchEntity')?.addEventListener('click', performEntitySearch);

async function showAllEntities() {
    const container = document.getElementById('selectEntityListContainer');
    const title = document.getElementById('selectEntityModalTitle');
    
    const isVenta = billingMode === 'venta';
    title.textContent = isVenta ? 'Seleccionar Cliente' : 'Seleccionar Proveedores';
    container.innerHTML = '<p style="padding:20px; text-align:center;">Cargando registros...</p>';
    
    showModal('modalSelectEntity');

    const table = isVenta ? 'clients' : 'providers';
    const { data, error } = await _supabase.from(table).select('*').order('name');

    if (error) {
        showToast("Error al cargar datos", "error");
        container.innerHTML = '<p style="padding:20px; text-align:center; color: #d63031;">Error al cargar registros</p>';
        return;
    }

    if (data && data.length > 0) {
        let html = `
            <table>
                <thead>
                    <tr>
                        <th>Nombre</th>
                        <th>Identificación</th>
                        <th>Acción</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.map(c => `
                        <tr>
                            <td>${c.name}</td>
                            <td>${c.cedula || c.nit || 'N/A'}</td>
                            <td><button class="action-btn" style="margin:0; padding:5px 10px;" onclick="selectEntityForSale(${JSON.stringify(c).replace(/"/g, '&quot;')})">Seleccionar</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
        container.innerHTML = html;
    } else {
        container.innerHTML = '<p style="padding:20px; text-align:center;">No hay registros disponibles</p>';
    }
}

function selectEntityForSale(entity) {
    if (billingMode === 'venta') {
        selectedEntity = entity;
        document.getElementById('entitySearchResults').classList.add('hidden');
        closeModals();
        goToStep2();
    } else {
        // Selección múltiple de proveedores (Máximo 5)
        if (selectedProviders.length >= 5) return showToast("Máximo 5 proveedores permitidos", "error");
        if (selectedProviders.find(p => p.nit === entity.nit)) return showToast("El proveedor ya está seleccionado", "error");

        selectedProviders.push(entity);
        document.getElementById('searchExistingEntity').value = "";
        document.getElementById('entitySearchResults').classList.add('hidden');
        // En modo compra no cerramos el modal automáticamente si queremos permitir selección múltiple rápida, 
        // pero por consistencia de UX se suele cerrar o actualizar. 
        // Aquí lo cerramos para confirmar la selección.
        closeModals(); 
        updateSelectedProvidersUI();
    }
}

function updateSelectedProvidersUI() {
    const list = document.getElementById('selectedProvidersList');
    const btn = document.getElementById('btnContinueToProducts');
    
    if (billingMode === 'venta' || selectedProviders.length === 0) {
        list.classList.add('hidden');
        btn.classList.add('hidden');
        return;
    }
    list.classList.remove('hidden');
    btn.classList.remove('hidden'); // Corregido: Ahora sale el botón al seleccionar al menos uno

    list.innerHTML = `
        <p style="font-size: 12px; font-weight: bold; margin-bottom: 10px;">Proveedores seleccionados (${selectedProviders.length}/5):</p>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            ${selectedProviders.map((p, idx) => `
                <div class="client-badge" style="margin: 0; background: #f1f3f5; display: flex; align-items: center; gap: 8px;">
                    ${p.name}
                    <span style="cursor: pointer; color: #d63031; font-weight: bold;" onclick="removeProvider(${idx})">×</span>
                </div>
            `).join('')}
        </div>
    `;
}

window.removeProvider = (idx) => {
    selectedProviders.splice(idx, 1);
    updateSelectedProvidersUI();
};

function prepareNewClientSale(type) {
    const form = document.getElementById('newClientSaleForm');
    form.classList.remove('hidden');
    document.getElementById('saleClientCedula').classList.toggle('hidden', type !== 'persona');
    document.getElementById('saleClientNit').classList.toggle('hidden', type !== 'negocio');
    form.dataset.type = type;
}

async function handleNewClientAndContinue() {
    const type = document.getElementById('newClientSaleForm').dataset.type;
    const name = document.getElementById('saleClientName').value;
    if (!name) return showToast("Nombre es requerido", "error");

    const clientData = {
        name,
        phone: document.getElementById('saleClientPhone').value,
        address: document.getElementById('saleClientAddress').value,
        email: document.getElementById('saleClientEmail').value
    };

    if (type === 'persona') clientData.cedula = parseInt(document.getElementById('saleClientCedula').value) || null;
    else clientData.nit = parseInt(document.getElementById('saleClientNit').value) || null;

    const { data, error } = await _supabase.from('clients').insert([clientData]).select().single();

    if (error) {
        showToast("Error registrando cliente: " + error.message, "error");
    } else {
        showToast("Cliente registrado y seleccionado");
        selectedEntity = data;
        goToStep2();
    }
}

// Búsqueda de Productos en Tiempo Real
document.getElementById('searchProductSales')?.addEventListener('input', (e) => {
    const val = normalizeText(e.target.value);
    const filtered = inventoryData.filter(item => 
        normalizeText(item.product).includes(val) || 
        normalizeText(item.code).includes(val)
    );
    renderInventorySales(filtered);
});

function renderInventorySales(items) {
    const list = document.getElementById('inventorySalesList');
    
    // En compras no filtramos por stock
    const availableItems = billingMode === 'venta' ? items.filter(item => item.amount > 0) : items;

    if (availableItems.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:#b2bec3; font-size:13px;">No hay coincidencias</p>';
        return;
    }

    const formatStockDisplay = (item) => {
        if (item.weigth && typeof item.weigth === 'object' && Object.keys(item.weigth).length > 0) {
            return Object.entries(item.weigth)
                .map(([key, value]) => `${formatNumber(value)} ${key}`)
                .join(' / ');
        }
        // Fallback si no hay `weigth`
        return `${formatNumber(item.amount)} ${Array.isArray(item.medit) ? item.medit[0] : item.medit || ''}`;
    };

    const formatSalePrice = (item) => {
        const price = billingMode === 'venta' ? item.sale_price : item.buy_price;
        if (price && typeof price === 'object') {
            return Object.entries(price)
                .map(([unit, val]) => `$ ${formatNumber(val)} / ${unit}`)
                .join('<br>');
        }
        if (price) return `$ ${formatNumber(price)}`;
        return 'No aplica';
    };

    list.innerHTML = availableItems.map(item => `
        <div class="product-sale-card">
            <div class="product-info-mini">
                <b>${item.product}</b>
                ${billingMode === 'venta' ? `<p>Stock: ${formatStockDisplay(item)}</p>` : ''}
                <p>${billingMode === 'venta' ? 'Precios Venta:' : 'Precio Compra:'} <br> ${formatSalePrice(item)}</p>
                <p style="color:#00b894; font-size:10px;">Cód: ${item.code}</p>
            </div>
            <button type="button" class="btn-add-cart" onclick="addToCart('${item.code}')">Agregar</button>
        </div>
    `).join('');
}

// Ingeniería de Sistemas: Restricción para que campos solo reciban números
['saleClientCedula', 'saleClientNit', 'saleClientPhone'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', function() {
        this.value = this.value.replace(/[^0-9]/g, '');
    });
});

// Gestión del Carrito (Placeholder funcional para FASE 9.4)
async function addToCart(code) {
    const prod = inventoryData.find(i => String(i.code) === String(code));
    if (!prod) return;

    productPendingToCart = prod;
    const form = document.getElementById('formAddQty');
    form.reset();

    const isVenta = billingMode === 'venta';

    const qtyInputsContainer = document.getElementById('qtyInputsContainer');
    const pricingUnitSelector = document.getElementById('pricingUnitSelector');
    const singleQtyLabel = document.getElementById('qtyLabel');
    const singleQtyInput = document.getElementById('saleQtyInput');

    qtyInputsContainer.innerHTML = ''; // Limpiar contenedor

    // Ingeniería de Sistemas: Verificación de existencia de elementos para evitar errores de null.
    if (pricingUnitSelector) {
        pricingUnitSelector.innerHTML = '';
        pricingUnitSelector.classList.add('hidden');
    }
    
    const priceEditContainer = document.getElementById('priceEditContainer');
    const priceInput = document.getElementById('unitPriceInput');
    const providerContainer = document.getElementById('itemProviderContainer');
    const providerSelect = document.getElementById('itemProviderSelect');
    const projectionContainer = document.getElementById('salePriceProjection');

    // Lógica para ventas con medidas/weigth
    const weigthKeys = isVenta && prod.weigth && typeof prod.weigth === 'object'
        ? Object.keys(prod.weigth)
        : [];
    
    let salePriceInfo = {};
    let pricingUnitDefault = null;
    if (isVenta && productPendingToCart.sale_price) {
        if (typeof productPendingToCart.sale_price === 'object') {
            salePriceInfo = productPendingToCart.sale_price;
            const spKeys = Object.keys(salePriceInfo);
            if (spKeys.length === 1) {
                pricingUnitDefault = spKeys[0];
            }
        } else if (typeof productPendingToCart.sale_price === 'number') {
            pricingUnitDefault = weigthKeys[0] || (Array.isArray(prod.medit) ? prod.medit[0] : prod.medit) || 'Unidad';
            salePriceInfo = { [pricingUnitDefault]: productPendingToCart.sale_price };
        }
    }

    const hasMultipleSalePrices = Object.keys(salePriceInfo).length > 1;

    if (isVenta && weigthKeys.length > 0) {
        if (singleQtyLabel) singleQtyLabel.classList.add('hidden');
        if (singleQtyInput) singleQtyInput.classList.add('hidden');

        document.getElementById('qtyProductInfo').innerHTML = `<b>Producto:</b> ${prod.product}`;

        // Mostrar inputs para TODAS las medidas del weigth
        qtyInputsContainer.innerHTML = weigthKeys.map(medit => `
            <div style="flex: 1;">
                <label style="font-size: 12px; color: #636e72;">Unidades a vender (${medit}):</label>
                <input type="number" class="sale-qty-input" data-medit="${medit}" placeholder="0" data-max="${prod.weigth[medit] || 0}" step="any" min="0">
                <div style="font-size: 11px; color: #636e72; text-align: right;">Disp: ${formatNumber(prod.weigth[medit] || 0)}</div>
            </div>
        `).join('');

        // Radios solo si hay múltiples precios por medida
        if (hasMultipleSalePrices && pricingUnitSelector) {
            pricingUnitSelector.classList.remove('hidden');
            pricingUnitSelector.innerHTML = `
                <label style="font-size: 12px; color: #636e72; font-weight: bold;">Calcular precio basado en:</label>
                <div style="display: flex; gap: 15px; margin-top: 5px;">
                ${weigthKeys.map((medit, index) => {
                    const priceText = salePriceInfo[medit]
                        ? ` ($${formatNumber(salePriceInfo[medit])})`
                        : '';
                    return `
                    <label style="display: flex; align-items: center; gap: 5px; font-size: 14px;">
                        <input type="radio" name="pricingUnit" value="${medit}" ${(!pricingUnitDefault || index === 0) ? 'checked' : ''}>
                        ${medit}${priceText}
                    </label>
                    `;
                }).join('')}
                </div>
            `;
        } else if (pricingUnitSelector) {
            pricingUnitSelector.classList.add('hidden');
            pricingUnitSelector.innerHTML = '';
        }

        // Proyección en tiempo real
        projectionContainer.classList.remove('hidden');

        const updateProjection = () => {
            const selectedRadio = document.querySelector('input[name="pricingUnit"]:checked');
            const pricingUnit = selectedRadio ? selectedRadio.value : (pricingUnitDefault || weigthKeys[0]);
            const qtyInput = document.querySelector(`.sale-qty-input[data-medit="${pricingUnit}"]`);
            const quantity = parseFloat(qtyInput?.value) || 0;
            const salePrice = salePriceInfo[pricingUnit] || 0;
            const projection = quantity * salePrice;
            projectionContainer.textContent = `Proyección de Venta: $ ${formatNumber(projection)}`;
        };

        document.querySelectorAll('.sale-qty-input').forEach(input => {
            input.addEventListener('input', updateProjection);
        });
        const radios = document.querySelectorAll('input[name="pricingUnit"]');
        radios.forEach(r => r.addEventListener('change', updateProjection));

        updateProjection();

    } else {
        // Lógica para productos sin weigth o con una sola medida/precio
        if (singleQtyLabel) singleQtyLabel.classList.remove('hidden');
        if (singleQtyInput) singleQtyInput.classList.remove('hidden');
        
        const defaultMedit = pricingUnitDefault || (Array.isArray(prod.medit) ? prod.medit[0] : prod.medit) || 'Unidad';
        singleQtyLabel.textContent = isVenta ? `Cantidad a vender (${defaultMedit}):` : `Cantidad a comprar (${defaultMedit}):`;
        
        document.getElementById('qtyProductInfo').innerHTML = `
            <b>Producto:</b> ${prod.product}<br>
            ${isVenta ? `<b>Stock disponible:</b> ${formatNumber(prod.amount)} ${defaultMedit}` : ''}
        `;
        singleQtyInput.value = 1;
        projectionContainer.classList.add('hidden');
    }

    if (isVenta) {
        priceEditContainer.classList.add('hidden');
        providerContainer.classList.add('hidden');

        // Validar que la cantidad no exceda el stock para cada input dinámico
        document.querySelectorAll('.sale-qty-input').forEach(input => {
            input.addEventListener('input', () => {
                const max = parseFloat(input.dataset.max) || 0;
                if (parseFloat(input.value) > max) {
                    input.value = max;
                    showToast("La cantidad no puede exceder el stock disponible.", "error");
                }
            });
        });

        // Validar también el input único
        // Ingeniería de Sistemas: Verificación de existencia del elemento para evitar error de null.
        if (singleQtyInput) {
            singleQtyInput.max = prod.amount;
            singleQtyInput.addEventListener('input', () => {
                if (parseFloat(singleQtyInput.value) > prod.amount) {
                    singleQtyInput.value = prod.amount;
                    showToast("La cantidad no puede exceder el stock disponible.", "error");
                }
            });
        }

    } else {
        singleQtyInput.removeAttribute('max');
        priceEditContainer.classList.remove('hidden');
        priceInput.value = formatNumber(prod.buy_price || 0);
        
        // Ingeniería de Sistemas: Selección automática de proveedor
        const offeringProvs = selectedProviders.filter(prov => 
            Array.isArray(prov.product) && prov.product.some(p => normalizeText(p) === normalizeText(prod.product))
        );

        if (offeringProvs.length === 1) {
            // Auto-selección si solo hay un proveedor para este producto
            providerContainer.classList.add('hidden');
            providerSelect.innerHTML = `<option value="${offeringProvs[0].name}" data-nit="${offeringProvs[0].nit}" selected>${offeringProvs[0].name}</option>`;
        } else {
            // Opción de elegir si hay múltiples proveedores
            providerContainer.classList.remove('hidden');
            providerSelect.innerHTML = '<option value="" disabled selected hidden>Seleccione el proveedor</option>';
            providerSelect.innerHTML += offeringProvs.map(p => `<option value="${p.name}" data-nit="${p.nit}">${p.name}</option>`).join('');
            if (offeringProvs.length === 0) {
                providerSelect.innerHTML += '<option value="" disabled>Ningún proveedor seleccionado ofrece este producto</option>';
            }
        }
    }

    showModal('modalAddProductQty');
}

document.getElementById('formAddQty')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!productPendingToCart) return;

    const isVenta = billingMode === 'venta';
    let quantities = {};
    let totalQuantity = 0;
    let pricingUnit = null;

    // Determinar si hay multi-medida y multi-precio
    const weigthKeys = isVenta && productPendingToCart.weigth && typeof productPendingToCart.weigth === 'object'
        ? Object.keys(productPendingToCart.weigth)
        : [];
    
    let salePriceInfo = {};
    let pricingUnitDefault = null;
    if (isVenta && productPendingToCart.sale_price) {
        if (typeof productPendingToCart.sale_price === 'object') {
            salePriceInfo = productPendingToCart.sale_price;
            const spKeys = Object.keys(salePriceInfo);
            if (spKeys.length === 1) {
                pricingUnitDefault = spKeys[0];
            }
        } else if (typeof productPendingToCart.sale_price === 'number') {
            pricingUnitDefault = weigthKeys[0] || (Array.isArray(productPendingToCart.medit) ? productPendingToCart.medit[0] : productPendingToCart.medit) || 'Unidad';
            salePriceInfo = { [pricingUnitDefault]: productPendingToCart.sale_price };
        }
    }

    if (isVenta && weigthKeys.length > 0) {
        const emptyInputs = [];

        document.querySelectorAll('.sale-qty-input').forEach(input => {
            const value = parseFloat(input.value) || 0;
            if (value > 0) {
                quantities[input.dataset.medit] = value;
            }
            if (!input.value || parseFloat(input.value) <= 0) {
                emptyInputs.push(input.dataset.medit);
            }
        });

        if (emptyInputs.length > 0) {
            return showToast(`Ingrese cantidad para: ${emptyInputs.join(', ')}`, "error");
        }

        totalQuantity = Object.values(quantities).reduce((sum, qty) => sum + qty, 0);

        const selectedRadio = document.querySelector('input[name="pricingUnit"]:checked');
        pricingUnit = selectedRadio ? selectedRadio.value : pricingUnitDefault;
    } else {
        const qty = parseFloat(document.getElementById('saleQtyInput').value);
        if (isNaN(qty) || qty <= 0) return showToast("Ingrese una cantidad válida", "error");
        const defaultMedit = pricingUnitDefault || (Array.isArray(productPendingToCart.medit) ? productPendingToCart.medit[0] : productPendingToCart.medit) || 'Unidad';
        quantities[defaultMedit] = qty;
        totalQuantity = qty;
        pricingUnit = defaultMedit;
    }

    if (totalQuantity <= 0) return showToast("Ingrese una cantidad válida", "error");

    let providerName = "";
    let providerNit = null;

    if (!isVenta) {
        const pSelect = document.getElementById('itemProviderSelect');
        if (!pSelect.value) return showToast("Debe seleccionar un proveedor", "error");
        providerName = pSelect.value;
        providerNit = pSelect.options[pSelect.selectedIndex].dataset.nit;
    } 

    // En compras permitimos editar el precio, en ventas usamos el sale_price fijo
    let unitPrice;
    if (isVenta) {
        // Obtener el precio según la unidad seleccionada o por defecto
        if (productPendingToCart.sale_price && typeof productPendingToCart.sale_price === 'object') {
            unitPrice = salePriceInfo[pricingUnit] || 0;
        } else if (typeof productPendingToCart.sale_price === 'number') {
            unitPrice = productPendingToCart.sale_price || 0;
        } else {
            unitPrice = 0;
        }
    } else {
        unitPrice = parseInt(document.getElementById('unitPriceInput').value.replace(/\D/g, '')) || 0;
        
        // Ingeniería de Backend: Actualizar precio de compra maestro en la tabla 'products'
        const { error: updatePriceErr } = await _supabase
            .from('products')
            .update({ buy_price: unitPrice, total: 0 })
            .eq('base_code', productPendingToCart.code);
        
        if (updatePriceErr) console.error("Error al actualizar precio maestro:", updatePriceErr);
    }

    const existing = cart.find(item => String(item.code) === String(productPendingToCart.code));
    const quantityForPriceCalc = parseFloat(quantities[pricingUnit]) || 0;

    if (existing) {
        Object.entries(quantities).forEach(([medit, qty]) => {
            existing.quantities[medit] = (existing.quantities[medit] || 0) + qty;
        });
        existing.pricingUnit = pricingUnit;
        existing.quantity = existing.quantity + quantityForPriceCalc;
        existing.total = existing.quantity * existing.price;
    } else {
        cart.push({
            code: productPendingToCart.code,
            name: productPendingToCart.product,
            quantities: quantities,
            quantity: quantityForPriceCalc,
            pricingUnit: pricingUnit,
            price: unitPrice,
            total: quantityForPriceCalc * unitPrice,
            providerName: providerName,
            providerNit: providerNit
        });
    }
    updateCartUI();
    closeModals();
    productPendingToCart = null;
});

function updateCartUI() {
    const tbody = document.getElementById('cartItemsBody');
    const totalSpan = document.getElementById('cartTotalValue');

    const isVenta = billingMode === 'venta';
    // Ingeniería de UI: Mostrar columna proveedor siempre que sea modo compra
    const showProviderCol = !isVenta;
    document.getElementById('cartProviderHeader').classList.toggle('hidden', !showProviderCol);

    if (cart.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${showProviderCol ? 6 : 5}" style="text-align:center; padding: 20px; color: #b2bec3;">No hay productos agregados</td></tr>`;
        totalSpan.textContent = "$ 0";
        document.getElementById('btnSiguientePago').classList.add('hidden');
        return;
    }

    const formatQuantities = (item) => {
        if (item.quantities && Object.keys(item.quantities).length > 1 && item.pricingUnit) {
            const qty = item.quantities[item.pricingUnit];
            return `${formatNumber(qty)} ${item.pricingUnit}`;
        } else if (item.quantities) {
            const [medit, qty] = Object.entries(item.quantities)[0];
            return `${formatNumber(qty)} ${medit}`;
        }
        // Fallback para items antiguos o de una sola unidad
        return formatNumber(item.quantity);
    };

    tbody.innerHTML = cart.map((item, index) => `
        <tr class="cart-item-row">
            <td><small>${item.code}</small></td>
            <td>${item.name}</td>
            ${showProviderCol ? `<td><small>${item.providerName}</small></td>` : ''}
            <td>${formatQuantities(item)}</td>
            <td>$ ${formatNumber(item.price)}</td>
            <td>$ ${formatNumber(item.total)}</td>
            <td><button class="btn-cancel" style="padding:2px 5px; width:auto;" onclick="removeFromCart(${index})">×</button></td>
        </tr>
    `).join('');

    const totalGeneral = cart.reduce((sum, item) => sum + item.total, 0);
    totalSpan.textContent = `$ ${formatNumber(totalGeneral)}`;
    document.getElementById('btnSiguientePago').classList.remove('hidden');
}

function calculateChange() {
    const input = document.getElementById('cashReceivedInput');
    let val = parseInt(input.value.replace(/\D/g, '')) || 0;
    input.value = formatNumber(val);
    
    const totalGeneral = cart.reduce((sum, item) => sum + item.total, 0);
    const change = val - totalGeneral;
    const resultDiv = document.getElementById('changeResult');
    const summaryReceived = document.getElementById('saleReceivedValue');
    const summaryChange = document.getElementById('saleChangeValue');
    
    if (summaryReceived) summaryReceived.textContent = `$ ${formatNumber(val)}`;

    if (val >= totalGeneral) {
        resultDiv.innerHTML = `Cambio a devolver: <span style="color: #00b894;">$ ${formatNumber(change)}</span>`;
        summaryChange.textContent = `$ ${formatNumber(change)}`;
    } else {
        resultDiv.innerHTML = `Faltante: <span style="color: #d63031;">$ ${formatNumber(Math.abs(change))}</span>`;
        summaryChange.textContent = `$ 0 (Faltante)`;
    }
}

async function liquidarVenta() {
    const method = document.getElementById('paymentMethod').value;
    if (!method) return showToast("Seleccione un método de pago", "error");

    const totalGeneral = cart.reduce((sum, item) => sum + item.total, 0);
    let changeValue = 0;
    let amountReceived = 0;

    if (method === 'Efectivo') {
        amountReceived = parseInt(document.getElementById('cashReceivedInput').value.replace(/\D/g, '')) || 0;
        if (amountReceived < totalGeneral) return showToast("El valor recibido es insuficiente", "error");
        changeValue = amountReceived - totalGeneral;
    }
    const timestamp = getColombiaTimestamp();

    if (billingMode === 'venta') {
        // Obtener siguiente número de factura para ventas
        const { count } = await _supabase.from('sales').select('*', { count: 'exact', head: true });
        const invoice_number = String((count || 0) + 1).padStart(6, '0');

        const saleData = {
            invoice_number: invoice_number,
            products_value: cart.map(item => item.price),
            codes: cart.map(item => item.code),
            products: cart.map(item => item.name),
            client: selectedEntity.name,
            client_cedula: parseInt(selectedEntity.cedula || selectedEntity.nit),
            total_to_pay: totalGeneral,
            payment_method: method,
            farm: selectedFarm,
            change: changeValue,
            created_at: timestamp
        };
        
        const pdfData = {
            invoice_number: invoice_number,
            type: 'venta',
            date: timestamp, // generatePDFInvoice aplicará format12h
            items: [...cart],
            total: totalGeneral,
            method: method,
            received: amountReceived,
            change: changeValue,
            entityName: selectedEntity.name,
            entityId: selectedEntity.cedula || selectedEntity.nit,
            farm: selectedFarm
        };

        const { error } = await _supabase.from('sales').insert([saleData]);

        if (error) {
            showToast("Error al liquidar venta: " + error.message, "error");
        } else {
            showToast("Venta liquidada"); // No longer updating inventory from here
            generatePDFInvoice(pdfData);
            initSalesProcess();
        }
    } else {
        // Obtener siguiente número de factura para compras
        const { count: buyCount } = await _supabase.from('buys').select('*', { count: 'exact', head: true });
        const invoice_number = String((buyCount || 0) + 1).padStart(6, '0');

        const buyData = {
            invoice_number: invoice_number,
            product: cart.map(item => item.name),
            code: cart.map(item => item.code),
            product_value: cart.map(item => item.price),
            provider: cart.map(item => item.providerName),
            nit: cart.map(item => parseInt(item.providerNit)),
            total_payed: totalGeneral,
            payment_method: method,
            change: changeValue,
            created_at: timestamp
        };

        const pdfData = {
            invoice_number: invoice_number,
            type: 'compra',
            date: timestamp, // generatePDFInvoice aplicará format12h
            items: [...cart],
            total: totalGeneral,
            method: method,
            received: amountReceived,
            change: changeValue
        };

        const { error } = await _supabase.from('buys').insert([buyData]);

        if (error) {
            showToast("Error al liquidar compra: " + error.message, "error");
        } else {
            // Ingeniería de Backend: Aumentar stock global en catálogo (tabla products)
            let prodError = false;
            for (const item of cart) {
                const { data: prodData } = await _supabase
                    .from('products')
                    .select('unit')
                    .eq('code', item.code)
                    .maybeSingle();

                if (prodData) {
                    const newGlobalStock = (prodData.unit || 0) + item.quantity;
                    const { error: updErr } = await _supabase
                        .from('products')
                        .update({ unit: newGlobalStock })
                        .eq('code', item.code);
                    
                    if (updErr) prodError = true;
                }
            }

            if (prodError) showToast("Compra registrada, error al actualizar catálogo", "error");
            else {
                showToast("Compra liquidada y catálogo actualizado exitosamente");
                generatePDFInvoice(pdfData);
            }
            initSalesProcess();
        }
    }
}

/**
 * Ingeniería de Sistemas: Generador de Factura PDF A4
 */
function generatePDFInvoice(data) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const primaryColor = [0, 184, 148]; // #00b894
    const f = franchiseData || { social_reason: "Granjas La Provincia", nit: "N/A", email: "", phone: "" };

    // Cabecera
    doc.setFontSize(22);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text(f.social_reason, 105, 20, { align: "center" });
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`NIT: ${f.nit} | Tel: ${f.phone}`, 105, 27, { align: "center" });
    doc.text(`Correo: ${f.email}`, 105, 33, { align: "center" });
    doc.text(`Comprobante de ${data.type.toUpperCase()} No. ${data.invoice_number}`, 105, 39, { align: "center" });

    doc.setDrawColor(200);
    doc.line(15, 45, 195, 45);

    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(`Fecha/Hora: ${format12h(data.date)}`, 15, 50);
    
    if (data.type === 'venta') {
        doc.text(`Cliente: ${data.entityName}`, 15, 57);
        doc.text(`Identificación: ${data.entityId}`, 15, 64);
        doc.text(`Sede Origen: ${data.farm}`, 15, 71);
    } else {
        const providers = [...new Set(data.items.map(i => i.providerName))];
        doc.text(`Proveedores involucrados: ${providers.join(', ')}`, 15, 57);
    }

    // Tabla de Contenido
    const headers = [["Cód.", "Producto", "Cant.", "Precio Unit.", "Subtotal"]];
    if (data.type === 'compra') headers[0].splice(2, 0, "Proveedor");

    const body = data.items.map(item => {
        const row = [item.code, item.name, item.quantity, `$ ${formatNumber(item.price)}`, `$ ${formatNumber(item.total)}` ];
        if (data.type === 'compra') row.splice(2, 0, item.providerName);
        return row;
    });

    doc.autoTable({
        startY: 80,
        head: headers,
        body: body,
        theme: 'grid',
        styles: { cellPadding: 3, fontSize: 9, lineColor: [178, 190, 195], lineWidth: 0.1 }, // Color #b2bec3
        headStyles: { fillColor: primaryColor },
        styles: { fontSize: 9 }
    });

    // Resumen Final
    const finalY = doc.lastAutoTable.finalY + 15;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`TOTAL FINAL: $ ${formatNumber(data.total)}`, 195, finalY, { align: "right" });
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Método de Pago: ${data.method}`, 15, finalY);
    
    if (data.method === 'Efectivo') {
        doc.text(`${data.type === 'venta' ? 'Efectivo Recibido' : 'Efectivo Entregado'}: $ ${formatNumber(data.received)}`, 15, finalY + 7);
        doc.text(`Cambio: $ ${formatNumber(data.change)}`, 15, finalY + 14);
    }

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text("Este documento es un soporte contable interno de Granjas La Provincia", 105, 285, { align: "center" });

    doc.save(`Factura_${data.type}_${data.invoice_number}.pdf`);
}

/**
 * Ingeniería de Sistemas: Preparación de la vista de facturas
 */
async function prepareFacturasView(type) {
    currentFacturasType = type;
    document.getElementById('currentFacturasType').textContent = type === 'ventas' ? 'Ventas' : 'Compras';

    // Reiniciar filtros al entrar a la vista
    const prodSelect = document.getElementById('filterProduct');
    const catSelect = document.getElementById('filterCategory');
    prodSelect.innerHTML = '<option value="" disabled selected hidden>Seleccione producto...</option>';
    prodSelect.disabled = true;
    catSelect.classList.add('hidden'); // Ocultar selector de categoría

    document.getElementById('facturasFilterBar').classList.remove('hidden');
    document.getElementById('facturasTableContainer').innerHTML = '<p style="padding:40px; text-align:center; color:#636e72;">Filtre para ver las facturas</p>';
    
    // Cargar productos para filtro
    const { data: products } = await _supabase.from('products').select('name').order('name');
    products?.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        prodSelect.appendChild(opt);
    });

    // Filtrado automático al cambiar cualquier input
    ['filterDateStart', 'filterDateEnd', 'filterProduct'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.onchange = () => loadFacturas(type, false);
            if (id.includes('Date')) el.oninput = () => loadFacturas(type, false);
        }
    });
}

/**
 * Lógica para filtrar y listar facturas (FASE 10.2)
 */
async function loadFacturas(type, viewAll = false) {
    const container = document.getElementById('facturasTableContainer');

    const dateStart = document.getElementById('filterDateStart').value;
    const dateEnd = document.getElementById('filterDateEnd').value;
    const productFilter = document.getElementById('filterProduct').value;

    if (!viewAll && !dateStart && !dateEnd && !productFilter) {
        container.innerHTML = '<p style="padding:40px; text-align:center; color:#636e72;">Filtre para ver las facturas</p>';
        return;
    }

    container.innerHTML = "<p style='padding:20px;'>Cargando registros...</p>";

    const table = type === 'ventas' ? 'sales' : 'buys';
    let { data, error } = await _supabase.from(table).select('*').order('created_at', { ascending: false });

    if (error) {
        showToast("Error al cargar historial", "error");
        return;
    }
    if (!viewAll) {
        const dateStart = document.getElementById('filterDateStart').value;
        const dateEnd = document.getElementById('filterDateEnd').value;
        const productFilter = document.getElementById('filterProduct').value; // Valor exacto del select

        data = data.filter(item => {
            const itemDate = item.created_at.split(' ')[0];
            const itemsList = type === 'ventas' ? (item.products || []) : (item.product || []);
            
            // Filtro de Fecha corregido
            if (dateStart && itemDate < dateStart) return false;
            if (dateEnd && itemDate > dateEnd) return false;

            // Filtro de Producto
            if (productFilter && !itemsList.some(p => p === productFilter)) return false;

            return true;
        });
    }

    if (!data || data.length === 0) {
        container.innerHTML = '<p style="padding:40px; text-align:center; color:#636e72;">No se encontraron facturas con los filtros aplicados</p>';
        return;
    }

    let html = `
        <table>
            <thead>
                <tr>
                    <th>No. Factura</th>
                    <th>Fecha</th>
                    <th>${type === 'ventas' ? 'Cliente' : 'Proveedores'}</th>
                    <th>Total</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(item => {
                    const entity = type === 'ventas' ? item.client : [...new Set(item.provider)].join(', ');
                    const total = type === 'ventas' ? item.total_to_pay : item.total_payed;
                    const cleanDate = format12h(item.created_at);
                    return `
                    <tr>
                        <td><b>${item.invoice_number || 'N/A'}</b></td>
                        <td>${cleanDate}</td>
                        <td>${entity}</td>
                        <td>$ ${formatNumber(total)}</td>
                        <td><button class="action-btn" onclick='viewFacturaDetail(${JSON.stringify(item)}, "${type}")'>Ver Detalle</button>
                            <button class="action-btn" style="background:#00b894;" onclick='downloadStoredInvoice(${JSON.stringify(item)}, "${type}")'>PDF</button>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;
    container.innerHTML = data.length ? html : '<p style="padding:20px; text-align:center;">No hay registros disponibles</p>';
}

function viewFacturaDetail(item, type) {
    const infoDiv = document.getElementById('detailModalInfo');
    const table = document.getElementById('detailModalTable');
    const isVenta = type === 'ventas';

    document.getElementById('detailModalTitle').textContent = `Detalle de ${isVenta ? 'Venta' : 'Compra'} No. ${item.invoice_number}`;
    
    infoDiv.innerHTML = `
        <strong>Fecha:</strong> ${format12h(item.created_at)}<br>
        <strong>${isVenta ? 'Cliente' : 'Proveedor(es)'}:</strong> ${isVenta ? item.client : [...new Set(item.provider)].join(', ')}<br>
        <strong>Método de Pago:</strong> ${item.payment_method}<br>
        <strong>Total:</strong> $ ${formatNumber(isVenta ? item.total_to_pay : item.total_payed)}
    `;
    // Reconstruir lista de productos
    const products = isVenta ? item.products : item.product;
    const codes = item.codes || item.code;
    const values = item.products_value || item.product_value;
    const providers = item.provider || [];
    let tableHtml = `
        <thead>
            <tr>
                <th>Cód</th>
                <th>Producto</th>
                ${!isVenta ? '<th>Proveedor</th>' : ''}
                <th>Precio</th>
            </tr>
        </thead>
        <tbody>
            ${products.map((p, i) => `
                <tr>
                    <td><small>${codes[i]}</small></td>
                    <td>${p}</td>
                    ${!isVenta ? `<td><small>${providers[i] || 'N/A'}</small></td>` : ''}
                    <td>$ ${formatNumber(values[i])}</td>
                </tr>
            `).join('')}
        </tbody>
    `;
    table.innerHTML = tableHtml;
    showModal('modalViewDetail');
}

function downloadStoredInvoice(item, type) {
    const isVenta = type === 'ventas';
    // Reconstruir items para el generador de PDF
    const products = isVenta ? item.products : item.product;
    const codes = isVenta ? item.codes : (item.code || []);
    const values = item.products_value || item.product_value;
    const providers = item.provider || [];

    const pdfData = {
        invoice_number: item.invoice_number,
        type: isVenta ? 'venta' : 'compra',
        date: item.created_at,
        total: isVenta ? item.total_to_pay : item.total_payed,
        method: item.payment_method,
        received: (isVenta ? item.total_to_pay : item.total_payed) + (item.change || 0),
        change: item.change || 0,
        entityName: isVenta ? item.client : "",
        entityId: isVenta ? item.client_cedula : "",
        farm: item.farm || "N/A",
        items: products.map((p, i) => ({
            code: codes[i],
            name: p,
            quantity: "-", // En el historial no guardamos cantidades por fila individual, se muestra soporte
            price: values[i],
            total: values[i],
            providerName: providers[i] || ""
        }))
    };
    generatePDFInvoice(pdfData);
}

function removeFromCart(index) {
    cart.splice(index, 1);
    updateCartUI();
}

// Exportar funciones para interactividad desde el DOM
window.addToCart = addToCart;
window.removeFromCart = removeFromCart;
window.showAllEntities = showAllEntities;
window.prepareFacturasView = prepareFacturasView;
window.loadFacturas = loadFacturas;

// Manejo de Modales y Creación de Clientes
function showModal(id) {
    document.getElementById('modalOverlay').classList.remove('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    if(id === 'modalCreateSupplier') loadProductsForSelect();
}

// Bloqueo de cierre por clic fuera para modal de selección de entidades
document.getElementById('modalOverlay')?.addEventListener('click', function(e) {
    if (e.target === this) {
        const modalSelect = document.getElementById('modalSelectEntity');
        if (modalSelect && !modalSelect.classList.contains('hidden')) {
            return; // No cerrar si es el modal de selección
        }
        closeModals();
    }
});

function closeModals() {
    document.getElementById('modalOverlay').classList.add('hidden');
    resetClientModal();
}

function showClientForm(type) {
    document.getElementById('clientTypeSelector').classList.add('hidden');
    const form = document.getElementById('formCreateClient');
    form.classList.remove('hidden');
    document.getElementById('clientType').value = type;
    
    const nameInput = document.getElementById('clientName');
    const cedulaInput = document.getElementById('clientCedula');
    const nitInput = document.getElementById('clientNit');
    
    if (type === 'persona') {
        nameInput.placeholder = "Nombre completo";
        cedulaInput.classList.remove('hidden');
        cedulaInput.required = true;
        nitInput.classList.add('hidden');
        nitInput.required = false;
        nitInput.value = "";
    } else {
        nameInput.placeholder = "Razon Social";
        nitInput.classList.remove('hidden');
        nitInput.required = true;
        cedulaInput.classList.add('hidden');
        cedulaInput.required = false;
        cedulaInput.value = "";
    }
}

function resetClientModal() {
    document.getElementById('clientTypeSelector').classList.remove('hidden');
    document.getElementById('formCreateClient').classList.add('hidden');
    document.getElementById('formCreateClient').reset();
}

document.getElementById('formCreateClient')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('clientType').value;
    const clientData = {
        name: document.getElementById('clientName').value,
        phone: document.getElementById('clientPhone').value,
        address: document.getElementById('clientAddress').value,
        email: document.getElementById('clientEmail').value
    };

    if (type === 'persona') {
        const cedulaVal = document.getElementById('clientCedula').value;
        clientData.cedula = cedulaVal ? parseInt(cedulaVal) : null;
    } else {
        const nitVal = document.getElementById('clientNit').value;
        clientData.nit = nitVal ? parseInt(nitVal) : null;
    }

    const { error } = await _supabase.from('clients').insert([clientData]);

    if (error) {
        showToast("Error al registrar cliente: " + error.message, "error");
    } else {
        showToast("Cliente registrado exitosamente");
        closeModals();
        loadClients(type);
    }
});

document.getElementById('btnCompras')?.addEventListener('click', () => {
    switchView('comprasView');
    renderEmpty('comprasTableContainer');
});

document.getElementById('btnFacturas')?.addEventListener('click', () => {
    switchView('facturasView');
    document.getElementById('facturasFilterBar').classList.add('hidden');
    document.getElementById('currentFacturasType').textContent = "---";
    document.getElementById('facturasTableContainer').innerHTML = `
        <div style="text-align:center; padding: 50px; color: #636e72;">
            <h3>Seleccione el historial de factura que desee consultar</h3>
        </div>`;
});

// Ingeniería de Sistemas: Formateo de precio unitario editable en modal de compras
document.getElementById('unitPriceInput')?.addEventListener('input', function(e) {
    let val = e.target.value.replace(/\D/g, '');
    e.target.value = formatNumber(val);
});

// --- Ingeniería de Soporte para Formularios Maestros ---

/**
 * Carga la lista de productos existentes para el selector múltiple del proveedor
 */
async function loadProductsForSelect() {
    const { data } = await _supabase.from('products').select('name');
    const select = document.getElementById('supProducts');
    if (select) select.innerHTML = data?.map(p => `<option value="${p.name}">${p.name}</option>`).join('') || '';
}

// Formateo de precios en tiempo real para los modales maestros
['prodBuyPrice', 'prodSalePrice'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', function(e) {
        let val = e.target.value.replace(/\D/g, '');
        e.target.value = formatNumber(val);
    });
});

document.getElementById('prodUnit')?.addEventListener('input', () => {
    if (typeof updateProductTotalProjection === 'function') updateProductTotalProjection();
});

/**
 * Manejador para el registro de nuevos proveedores desde Facturación
 */
document.getElementById('formCreateSupplier')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const supplierData = {
        name: document.getElementById('supName').value,
        nit: parseInt(document.getElementById('supNit').value),
        product: Array.from(document.getElementById('supProducts').selectedOptions).map(opt => opt.value),
        created_at: getColombiaTimestamp()
    };
    const { error } = await _supabase.from('providers').insert([supplierData]);
    if (error) showToast("Error: " + error.message, "error");
    else { 
        showToast("Proveedor registrado exitosamente"); 
        closeModals(); 
    }
});

/**
 * Manejador para el registro de nuevos productos desde Facturación
 */
document.getElementById('formCreateProduct')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const hasWeight = document.getElementById('prodHasWeight')?.checked;
    const isAnimal = document.getElementById('prodIsAnimal')?.checked || false;
    const toSale = document.getElementById('prodForSale')?.checked !== false;

    const baseCode = document.getElementById('prodCode').value;

    // Validación para prevenir duplicados de productos base
    const { data: existing, error: checkError } = await _supabase
        .from('products')
        .select('base_code')
        .eq('base_code', baseCode)
        .eq('inventory', false)
        .maybeSingle();

    if (checkError) return showToast("Error de validación: " + checkError.message, "error");
    if (existing) return showToast(`Error: Ya existe una definición de producto con el código ${baseCode}.`, "error");

    const productData = {
        base_code: baseCode,
        inventory_code: null, // No es un item de inventario
        name: document.getElementById('prodName').value,
        unit: parseFloat(document.getElementById('prodUnit').value) || 0,
        medit: document.getElementById('prodMedit').value,
        buy_price: isAnimal ? null : (parseInt(document.getElementById('prodBuyPrice').value.replace(/\./g, '')) || 0),
        sale_price: isAnimal ? null : (parseInt(document.getElementById('prodSalePrice').value.replace(/\./g, '')) || 0),
        created_at: getColombiaTimestamp(),
        weigth: hasWeight ? (parseFloat(document.getElementById('prodWeight').value) || 0) : null,
        animal: isAnimal,
        to_sale: toSale,
        inventory: false // Es una definición de producto
    };
    const { error } = await _supabase.from('products').insert([productData]);
    if (error) showToast("Error: " + error.message, "error");
    else { 
        showToast("Producto agregado al catálogo"); 
        closeModals(); 
        // Si estamos en modo compra, refrescamos la lista para que aparezca el nuevo producto
        if (billingMode === 'compra') {
            loadInventoryForSales();
        }
    }
});

// Listeners para el nuevo campo de peso en el módulo de facturación
document.getElementById('prodHasWeight')?.addEventListener('change', function() {
    const container = document.getElementById('prodWeightContainer');
    const salePriceKgContainer = document.getElementById('prodSalePriceKgContainer');
    const forSale = document.getElementById('prodForSale')?.checked;

    if (container) {
        container.classList.toggle('hidden', !this.checked);
        if (!this.checked) document.getElementById('prodWeight').value = "";
    }
    if (salePriceKgContainer) {
        salePriceKgContainer.classList.toggle('hidden', !this.checked || !forSale);
    }
});

// Asegurar que el input de peso en facturación también solo reciba números
document.getElementById('prodWeight')?.addEventListener('input', function(e) {
    this.value = this.value.replace(/[^0-9.]/g, '');
});

function renderEmpty(containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = `
        <table>
            <tbody>
                <tr>
                    <td style="text-align:center; padding: 20px;">No hay datos para mostrar en este momento</td>
                </tr>
            </tbody>
        </table>`;
}

// Verificación de sesión al cargar el módulo
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) {
        window.location.href = '../index.html';
    } else {
        // Cargar datos de la franquicia para los PDFs
        const { data } = await _supabase.from('province').select('*').maybeSingle();
        franchiseData = data;
        if (!data) showToast("Advertencia: No se detectaron datos de franquicia", "error");
        else showToast("Módulo de Facturación cargado");
    }
});
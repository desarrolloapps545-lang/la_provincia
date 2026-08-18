const SUPABASE_URL = "https://zvxnksnsovtlczausrvl.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2eG5rc25zb3Z0bGN6YXVzcnZsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTY3Nzc0NSwiZXhwIjoyMDkxMjUzNzQ1fQ.ai6JYAE43_HCmIXTR6McoTHkEi0wYuMszqCQn-pMhaA";
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const formatNumber = (num) => {
    if (num === null || num === undefined) return "0";
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

// Normaliza el amount (JSONB) a un objeto { medida: valor }
const normalizeAmount = (amount) => {
    if (amount && typeof amount === 'object') return amount;
    return { 'Unidad': (typeof amount === 'number' ? amount : 0) };
};

// Formatea un objeto amount JSONB como "100 kg, 5 unidad"
const formatAmountJsonb = (obj) => {
    if (!obj || typeof obj !== 'object') return '-';
    const entries = Object.entries(obj).filter(([, v]) => (v || 0) !== 0);
    if (entries.length === 0) return '-';
    return entries.map(([k, v]) => `${formatNumber(v)} ${k}`).join(', ');
};

// Ingeniería de Frontend: Helper para Toasts
const showToast = (message, type = 'success') => {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast`;
    toast.style.backgroundColor = type === 'error' ? '#d63031' : '#00b894';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
};

async function initKardex() {
    const productSelect = document.getElementById('productSelect');
    const farmSelect = document.getElementById('farmSelect');
    
    // Ingeniería de Backend: Obtener contexto del usuario para aplicar restricciones de granja
    const { data: { session } } = await _supabase.auth.getSession();
    let userFarm = null;

    if (session) {
        const { data: profile } = await _supabase
            .from('users')
            .select('farm')
            .eq('id', session.user.id)
            .single();
        
        if (profile && profile.farm && profile.farm !== 'Todas las granjas') {
            userFarm = profile.farm;
        }
    }

    // Ingeniería de Backend: Carga de granjas para filtrado dinámico
    const { data: farms } = await _supabase.from('farms').select('name').order('name');
    if (farms) {
        farmSelect.innerHTML = `<option value="" ${!userFarm ? 'selected' : ''}>-- Todas las granjas --</option>` + 
            farms.map(f => `<option value="${f.name}">${f.name}</option>`).join('');
    }

    // Si el usuario tiene una granja asignada, bloqueamos el filtro
    if (userFarm) {
        farmSelect.value = userFarm;
        farmSelect.disabled = true;
    }

    // Inicialización del dropdown de productos (Vista Global por defecto)
    await updateProductDropdown();

    farmSelect.addEventListener('change', async () => {
        await updateProductDropdown();
        loadMovements(productSelect.value, farmSelect.value);
    });

    productSelect.addEventListener('change', (e) => loadMovements(e.target.value, farmSelect.value));
}

async function updateProductDropdown() {
    const farmSelect = document.getElementById('farmSelect');
    const productSelect = document.getElementById('productSelect');
    const farmName = farmSelect.value;

    let query = _supabase.from('products').select('name').eq('inventory', true).order('name');
    if (farmName) query = query.eq('farm', farmName);

    const { data: invItems, error } = await query;

    if (error) {
        console.error("Error cargando productos:", error);
        showToast("Error cargando productos", "error");
        return;
    }

    const uniqueProducts = [...new Set((invItems || []).map(i => i.name))];
    productSelect.innerHTML = '<option value="">-- Seleccione un producto --</option>' + 
        uniqueProducts.map(p => `<option value="${p}">${p}</option>`).join('');
}

async function loadMovements(productName, farmName) {
    const tbody = document.getElementById('kardexBody');
    if (!productName) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Seleccione un producto para ver sus movimientos</td></tr>';
        return;
    }

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Consultando historial...</td></tr>';

    // Ingeniería de Backend: Consulta cronológica de movimientos
    let query = _supabase
        .from('movements')
        .select('date_movement, type, amount, description, farm, created_at')
        .eq('name', productName)
        .order('created_at', { ascending: true });

    if (farmName) query = query.eq('farm', farmName);

    const { data: movements, error } = await query;

    if (error) {
        tbody.innerHTML = `<tr><td colspan="7" class="error-msg">Error: ${error.message}</td></tr>`;
        showToast("Error al consultar movimientos: " + error.message, "error");
        return;
    }

    if (movements.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No hay movimientos registrados para este producto</td></tr>';
        return;
    }

    const saldoPorMedida = {};
    let html = '';

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' +
               d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
    };

    movements.forEach(m => {
        const esIngreso = m.type.toLowerCase() === 'ingreso' || m.type.toLowerCase().includes('ingreso');
        const amountObj = normalizeAmount(m.amount);
        const moveDate = formatDate(m.created_at || m.date_movement);

        const entradaTxt = esIngreso ? formatAmountJsonb(amountObj) : '-';
        const salidaTxt = !esIngreso ? formatAmountJsonb(amountObj) : '-';

        Object.entries(amountObj).forEach(([medida, valor]) => {
            if (!saldoPorMedida[medida]) saldoPorMedida[medida] = 0;
            const change = esIngreso ? parseFloat(valor || 0) : -parseFloat(valor || 0);
            saldoPorMedida[medida] = parseFloat((saldoPorMedida[medida] + change).toFixed(3));
        });

        const saldoTxt = formatAmountJsonb(saldoPorMedida);

        html += `
            <tr>
                <td>${moveDate}</td>
                <td>${m.farm || 'N/A'}</td>
                <td><span class="${esIngreso ? 'text-ingreso' : 'text-salida'}">${m.type.toUpperCase()}</span></td>
                <td>${m.description || '-'}</td>
                <td>${entradaTxt}</td>
                <td>${salidaTxt}</td>
                <td class="text-saldo">${saldoTxt}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', initKardex);
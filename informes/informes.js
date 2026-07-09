// Verificación de sesión al cargar el módulo
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) {
        window.location.href = '../index.html';
    }
});

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

// Filtra el amount JSONB según el tipo de reporte (peso o unidad)
const filterAmountByType = (obj, type) => {
    const out = {};
    Object.entries(obj || {}).forEach(([k, v]) => {
        const isWeight = /kg|kilo|peso|gramo|\bg\b/i.test(k);
        if (type === 'peso' && isWeight) out[k] = v;
        if (type === 'unidad' && !isWeight) out[k] = v;
    });
    return out;
};

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

const showToast = (message, type = 'success') => {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : ''}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
};

function switchView(viewId) {
    document.getElementById('welcomeInformes').classList.add('hidden');
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
}

document.getElementById('btnInformeGanancias')?.addEventListener('click', () => {
    switchView('informeGananciasView');
});

document.getElementById('btnInformeCompras')?.addEventListener('click', () => {
    switchView('informeComprasView');
});

document.getElementById('btnInformeVentas')?.addEventListener('click', () => {
    switchView('informeVentasView');
});

document.getElementById('btnInformePeso')?.addEventListener('click', () => {
    switchView('informePesoView');
    loadProductFilters('pesoProductSelect');
});

document.getElementById('btnInformeUnidades')?.addEventListener('click', () => {
    switchView('informeUnidadesView');
    loadProductFilters('unidadesProductSelect');
});

async function loadProductFilters(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const { data } = await _supabase.from('products').select('name').eq('inventory', true).order('name');
    const unique = [...new Set((data || []).map(p => p.name))];
    select.innerHTML = '<option value="">Seleccione producto...</option>' +
        unique.map(p => `<option value="${p}">${p}</option>`).join('');
}

// ==========================================
// INFORME DE GANANCIAS
// ==========================================
async function generarInformeGanancias() {
    const container = document.getElementById('gananciasResultContainer');
    const start = document.getElementById('gananciasDateStart').value;
    const end = document.getElementById('gananciasDateEnd').value;

    container.innerHTML = '<p style="padding: 20px; text-align: center;">Cargando datos...</p>';

    const [salesRes, buysRes] = await Promise.all([
        _supabase.from('sales').select('total_to_pay, created_at, invoice_number').order('created_at', { ascending: true }),
        _supabase.from('buys').select('total_payed, created_at, invoice_number').order('created_at', { ascending: true })
    ]);

    if (salesRes.error) {
        container.innerHTML = `<p style="padding: 20px; color: #d63031;">Error al cargar ventas: ${salesRes.error.message}</p>`;
        return;
    }
    if (buysRes.error) {
        container.innerHTML = `<p style="padding: 20px; color: #d63031;">Error al cargar compras: ${buysRes.error.message}</p>`;
        return;
    }

    const filtrarPorFecha = (items) => {
        return items.filter(item => {
            const fecha = item.created_at ? item.created_at.split(' ')[0] : '';
            if (start && fecha < start) return false;
            if (end && fecha > end) return false;
            return true;
        });
    };

    const ventasFiltradas = filtrarPorFecha(salesRes.data || []);
    const comprasFiltradas = filtrarPorFecha(buysRes.data || []);

    if (ventasFiltradas.length === 0 && comprasFiltradas.length === 0) {
        container.innerHTML = '<p style="padding: 20px; text-align: center; color: #636e72;">No hay datos para el rango seleccionado</p>';
        return;
    }

    const totalVentas = ventasFiltradas.reduce((sum, s) => sum + (s.total_to_pay || 0), 0);
    const totalCompras = comprasFiltradas.reduce((sum, b) => sum + (b.total_payed || 0), 0);
    const gananciaNeta = totalVentas - totalCompras;

    const rowsVentas = ventasFiltradas.map(s => ({
        tipo: 'Venta',
        factura: s.invoice_number || 'N/A',
        fecha: format12h(s.created_at),
        total: s.total_to_pay || 0
    }));

    const rowsCompras = comprasFiltradas.map(c => ({
        tipo: 'Compra',
        factura: c.invoice_number || 'N/A',
        fecha: format12h(c.created_at),
        total: c.total_payed || 0
    }));

    const html = `
        <div style="padding: 20px;">
            <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; justify-content: center;">
                <div class="resumen-card positivo">
                    <div class="resumen-label">Total Ingresos (Ventas)</div>
                    <div class="resumen-value">$ ${formatNumber(totalVentas)}</div>
                </div>
                <div class="resumen-card negativo">
                    <div class="resumen-label">Total Egresos (Compras)</div>
                    <div class="resumen-value">$ ${formatNumber(totalCompras)}</div>
                </div>
                <div class="resumen-card ${gananciaNeta >= 0 ? 'positivo' : 'negativo'}">
                    <div class="resumen-label">Ganancia Neta</div>
                    <div class="resumen-value">$ ${formatNumber(gananciaNeta)}</div>
                </div>
            </div>

            <h4 style="margin-bottom: 15px; color: #2d3436;">Detalle de Ventas</h4>
            ${rowsVentas.length > 0 ? `
                <table style="margin-bottom: 30px;">
                    <thead>
                        <tr>
                            <th>Tipo</th>
                            <th>No. Factura</th>
                            <th>Fecha</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsVentas.map(r => `
                            <tr>
                                <td><span style="color: #00b894; font-weight: bold;">${r.tipo}</span></td>
                                <td>${r.factura}</td>
                                <td>${r.fecha}</td>
                                <td>$ ${formatNumber(r.total)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : '<p style="color: #636e72; margin-bottom: 30px;">No hay ventas en el periodo</p>'}

            <h4 style="margin-bottom: 15px; color: #2d3436;">Detalle de Compras</h4>
            ${rowsCompras.length > 0 ? `
                <table>
                    <thead>
                        <tr>
                            <th>Tipo</th>
                            <th>No. Factura</th>
                            <th>Fecha</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsCompras.map(r => `
                            <tr>
                                <td><span style="color: #e17055; font-weight: bold;">${r.tipo}</span></td>
                                <td>${r.factura}</td>
                                <td>${r.fecha}</td>
                                <td>$ ${formatNumber(r.total)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            ` : '<p style="color: #636e72;">No hay compras en el periodo</p>'}
        </div>
    `;

    container.innerHTML = html;
}

// ==========================================
// INFORME DE COMPRAS
// ==========================================
async function generarInformeCompras() {
    const container = document.getElementById('comprasResultContainer');
    const start = document.getElementById('comprasDateStart').value;
    const end = document.getElementById('comprasDateEnd').value;

    container.innerHTML = '<p style="padding: 20px; text-align: center;">Cargando datos...</p>';

    const { data: buys, error } = await _supabase
        .from('buys')
        .select('*')
        .order('created_at', { ascending: true });

    if (error) {
        container.innerHTML = `<p style="padding: 20px; color: #d63031;">Error: ${error.message}</p>`;
        return;
    }

    let filtered = buys || [];
    if (start) filtered = filtered.filter(b => b.created_at && b.created_at.split(' ')[0] >= start);
    if (end) filtered = filtered.filter(b => b.created_at && b.created_at.split(' ')[0] <= end);

    if (filtered.length === 0) {
        container.innerHTML = '<p style="padding: 20px; text-align: center; color: #636e72;">No hay datos para el rango seleccionado</p>';
        return;
    }

    const rows = filtered.map(buy => {
        const productos = buy.product || [];
        const valores = buy.product_value || [];
        const proveedores = buy.provider || [];
        const total = buy.total_payed || 0;

        const productosDetalle = productos.map((p, i) => {
            let meditValue = '';
            if (buy.medit) {
                if (Array.isArray(buy.medit)) {
                    meditValue = buy.medit[i] || '';
                } else {
                    meditValue = buy.medit;
                }
            }
            return `${p} ${meditValue} $${formatNumber(valores[i] || 0)}`;
        }).join(', ');

        const cantidades = (buy.amount && Array.isArray(buy.amount))
            ? buy.amount.map(amt => {
                return (amt && typeof amt === 'object')
                    ? Object.entries(amt).map(([k, v]) => `${formatNumber(v)} ${k}`).join(' / ')
                    : '-';
            }).join('<br>')
            : '-';

        return {
            factura: buy.invoice_number,
            fecha: format12h(buy.created_at),
            proveedores: [...new Set(proveedores)].join(', '),
            productos: productosDetalle || '-',
            cantidades: cantidades,
            total: total,
            metodo: buy.payment_method
        };
    });

    const totalCompras = rows.reduce((sum, r) => sum + r.total, 0);

    const html = `
        <div style="padding: 20px;">
            <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; justify-content: center;">
                <div class="resumen-card">
                    <div class="resumen-label">Total Compras</div>
                    <div class="resumen-value">$ ${formatNumber(totalCompras)}</div>
                </div>
                <div class="resumen-card">
                    <div class="resumen-label">Registros</div>
                    <div class="resumen-value">${rows.length}</div>
                </div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>No. Factura</th>
                        <th>Fecha</th>
                        <th>Proveedores</th>
                        <th>Productos</th>
                        <th>Cantidades</th>
                        <th>Total</th>
                        <th>Método de Pago</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td>${r.factura}</td>
                            <td>${r.fecha}</td>
                            <td>${r.proveedores}</td>
                            <td>${r.productos}</td>
                            <td>${r.cantidades}</td>
                            <td>$ ${formatNumber(r.total)}</td>
                            <td>${r.metodo}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

// ==========================================
// INFORME DE VENTAS
// ==========================================
async function generarInformeVentas() {
    const container = document.getElementById('ventasResultContainer');
    const start = document.getElementById('ventasDateStart').value;
    const end = document.getElementById('ventasDateEnd').value;

    container.innerHTML = '<p style="padding: 20px; text-align: center;">Cargando datos...</p>';

    const { data: sales, error } = await _supabase
        .from('sales')
        .select('*')
        .order('created_at', { ascending: true });

    if (error) {
        container.innerHTML = `<p style="padding: 20px; color: #d63031;">Error: ${error.message}</p>`;
        return;
    }

    let filtered = sales || [];
    if (start) filtered = filtered.filter(s => s.created_at && s.created_at.split(' ')[0] >= start);
    if (end) filtered = filtered.filter(s => s.created_at && s.created_at.split(' ')[0] <= end);

    if (filtered.length === 0) {
        container.innerHTML = '<p style="padding: 20px; text-align: center; color: #636e72;">No hay datos para el rango seleccionado</p>';
        return;
    }

    const rows = filtered.map(sale => {
        const productos = sale.products || [];
        const valores = sale.products_value || [];
        const productosDetalle = productos.map((p, i) => {
            let meditValue = '';
            if (sale.medit) {
                if (Array.isArray(sale.medit)) {
                    meditValue = sale.medit[i] || '';
                } else {
                    meditValue = sale.medit;
                }
            }
            return `${p} ${meditValue} $${formatNumber(valores[i] || 0)}`;
        }).join(', ');
        const cantidades = (sale.amount && Array.isArray(sale.amount))
            ? sale.amount.map(amt => {
                return (amt && typeof amt === 'object')
                    ? Object.entries(amt).map(([k, v]) => `${formatNumber(v)} ${k}`).join(' / ')
                    : '-';
            }).join('<br>')
            : '-';
        return {
            factura: sale.invoice_number,
            fecha: format12h(sale.created_at),
            cliente: sale.client,
            productos: productosDetalle || '-',
            cantidades: cantidades,
            total: sale.total_to_pay || 0,
            metodo: sale.payment_method,
            granja: sale.farm || '-'
        };
    });

    const totalVentas = rows.reduce((sum, r) => sum + r.total, 0);

    const html = `
        <div style="padding: 20px;">
            <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; justify-content: center;">
                <div class="resumen-card positivo">
                    <div class="resumen-label">Total Ventas</div>
                    <div class="resumen-value">$ ${formatNumber(totalVentas)}</div>
                </div>
                <div class="resumen-card">
                    <div class="resumen-label">Registros</div>
                    <div class="resumen-value">${rows.length}</div>
                </div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>No. Factura</th>
                        <th>Fecha</th>
                        <th>Cliente</th>
                        <th>Granja</th>
                        <th>Productos</th>
                        <th>Cantidades</th>
                        <th>Total</th>
                        <th>Método de Pago</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td>${r.factura}</td>
                            <td>${r.fecha}</td>
                            <td>${r.cliente}</td>
                            <td>${r.granja}</td>
                            <td>${r.productos}</td>
                            <td>${r.cantidades}</td>
                            <td>$ ${formatNumber(r.total)}</td>
                            <td>${r.metodo}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

// ==========================================
// INFORME DE PESO DE ENTRADA Y SALIDA
// ==========================================
async function generarInformePeso() {
    const container = document.getElementById('pesoResultContainer');
    const producto = document.getElementById('pesoProductSelect').value;
    const start = document.getElementById('pesoDateStart').value;
    const end = document.getElementById('pesoDateEnd').value;

    if (!producto) {
        showToast('Seleccione un producto', 'error');
        return;
    }

    container.innerHTML = '<p style="padding: 20px; text-align: center;">Cargando datos...</p>';

    let query = _supabase
        .from('movements')
        .select('*')
        .eq('name', producto)
        .order('created_at', { ascending: true });

    const { data: movements, error } = await query;

    if (error) {
        container.innerHTML = `<p style="padding: 20px; color: #d63031;">Error: ${error.message}</p>`;
        return;
    }

    let filtered = movements || [];
    if (start) filtered = filtered.filter(m => {
        const fecha = (m.date_movement || m.created_at || '').split(' ')[0];
        return fecha >= start;
    });
    if (end) filtered = filtered.filter(m => {
        const fecha = (m.date_movement || m.created_at || '').split(' ')[0];
        return fecha <= end;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<p style="padding: 20px; text-align: center; color: #636e72;">No hay movimientos para este producto en el rango seleccionado</p>';
        return;
    }

    const rows = filtered.map(m => {
        const esIngreso = m.type === 'ingreso' || m.type === 'ingreso_animal';
        const amountObj = filterAmountByType(normalizeAmount(m.amount), 'peso');
        return {
            fecha: format12h(m.created_at || m.date_movement),
            tipo: m.type.toUpperCase(),
            amountObj,
            descripcion: m.description || '-',
            esIngreso
        };
    });

    const medidasUnicas = [...new Set(rows.flatMap(r => Object.keys(r.amountObj)))];
    const totalesPorMedida = {};
    medidasUnicas.forEach(medida => {
        const ingreso = rows.reduce((sum, r) => sum + ((r.esIngreso && r.amountObj[medida]) || 0), 0);
        const salida = rows.reduce((sum, r) => sum + ((!r.esIngreso && r.amountObj[medida]) || 0), 0);
        totalesPorMedida[medida] = { ingreso, salida, saldo: ingreso - salida };
    });

    const resumenMedidas = medidasUnicas.map(medida => {
        const t = totalesPorMedida[medida];
        return `
            <div class="resumen-card">
                <div class="resumen-label">${medida} - Entrada</div>
                <div class="resumen-value" style="color: #00b894;">${formatNumber(t.ingreso)}</div>
            </div>
            <div class="resumen-card negativo">
                <div class="resumen-label">${medida} - Salida</div>
                <div class="resumen-value">${formatNumber(t.salida)}</div>
            </div>
            <div class="resumen-card ${t.saldo >= 0 ? 'positivo' : 'negativo'}">
                <div class="resumen-label">${medida} - Saldo</div>
                <div class="resumen-value">${formatNumber(t.saldo)}</div>
            </div>
        `;
    }).join('');

    const totalIngreso = rows.reduce((sum, r) => sum + Object.values(r.amountObj).reduce((a, v) => a + (r.esIngreso ? v : 0), 0), 0);
    const totalSalida = rows.reduce((sum, r) => sum + Object.values(r.amountObj).reduce((a, v) => a + (!r.esIngreso ? v : 0), 0), 0);
    const saldo = totalIngreso - totalSalida;

    const html = `
        <div style="padding: 20px;">
            <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; justify-content: center;">
                ${resumenMedidas}
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Tipo</th>
                        <th>Peso</th>
                        <th>Descripción</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td>${r.fecha}</td>
                            <td style="color: ${r.esIngreso ? '#00b894' : '#d63031'}; font-weight: bold;">${r.tipo}</td>
                            <td>${formatAmountJsonb(r.amountObj)}</td>
                            <td>${r.descripcion}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

// ==========================================
// INFORME DE UNIDADES DE ENTRADA Y SALIDA
// ==========================================
async function generarInformeUnidades() {
    const container = document.getElementById('unidadesResultContainer');
    const producto = document.getElementById('unidadesProductSelect').value;
    const start = document.getElementById('unidadesDateStart').value;
    const end = document.getElementById('unidadesDateEnd').value;

    if (!producto) {
        showToast('Seleccione un producto', 'error');
        return;
    }

    container.innerHTML = '<p style="padding: 20px; text-align: center;">Cargando datos...</p>';

    let query = _supabase
        .from('movements')
        .select('*')
        .eq('name', producto)
        .order('created_at', { ascending: true });

    const { data: movements, error } = await query;

    if (error) {
        container.innerHTML = `<p style="padding: 20px; color: #d63031;">Error: ${error.message}</p>`;
        return;
    }

    let filtered = movements || [];
    if (start) filtered = filtered.filter(m => {
        const fecha = (m.date_movement || m.created_at || '').split(' ')[0];
        return fecha >= start;
    });
    if (end) filtered = filtered.filter(m => {
        const fecha = (m.date_movement || m.created_at || '').split(' ')[0];
        return fecha <= end;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<p style="padding: 20px; text-align: center; color: #636e72;">No hay movimientos para este producto en el rango seleccionado</p>';
        return;
    }

    const rows = filtered.map(m => {
        const esIngreso = m.type === 'ingreso' || m.type === 'ingreso_animal';
        const amountObj = filterAmountByType(normalizeAmount(m.amount), 'unidad');
        return {
            fecha: format12h(m.created_at || m.date_movement),
            tipo: m.type.toUpperCase(),
            amountObj,
            descripcion: m.description || '-',
            esIngreso
        };
    });

    const medidasUnicas = [...new Set(rows.flatMap(r => Object.keys(r.amountObj)))];
    const totalesPorMedida = {};
    medidasUnicas.forEach(medida => {
        const ingreso = rows.reduce((sum, r) => sum + ((r.esIngreso && r.amountObj[medida]) || 0), 0);
        const salida = rows.reduce((sum, r) => sum + ((!r.esIngreso && r.amountObj[medida]) || 0), 0);
        totalesPorMedida[medida] = { ingreso, salida, saldo: ingreso - salida };
    });

    const resumenMedidas = medidasUnicas.map(medida => {
        const t = totalesPorMedida[medida];
        return `
            <div class="resumen-card positivo">
                <div class="resumen-label">${medida} - Entrada</div>
                <div class="resumen-value" style="color: #00b894;">${formatNumber(t.ingreso)}</div>
            </div>
            <div class="resumen-card negativo">
                <div class="resumen-label">${medida} - Salida</div>
                <div class="resumen-value">${formatNumber(t.salida)}</div>
            </div>
            <div class="resumen-card ${t.saldo >= 0 ? 'positivo' : 'negativo'}">
                <div class="resumen-label">${medida} - Saldo</div>
                <div class="resumen-value">${formatNumber(t.saldo)}</div>
            </div>
        `;
    }).join('');

    const totalIngreso = rows.reduce((sum, r) => sum + Object.values(r.amountObj).reduce((a, v) => a + (r.esIngreso ? v : 0), 0), 0);
    const totalSalida = rows.reduce((sum, r) => sum + Object.values(r.amountObj).reduce((a, v) => a + (!r.esIngreso ? v : 0), 0), 0);
    const saldo = totalIngreso - totalSalida;

    const html = `
        <div style="padding: 20px;">
            <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; justify-content: center;">
                ${resumenMedidas}
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Tipo</th>
                        <th>Unidades</th>
                        <th>Descripción</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td>${r.fecha}</td>
                            <td style="color: ${r.esIngreso ? '#00b894' : '#d63031'}; font-weight: bold;">${r.tipo}</td>
                            <td>${formatAmountJsonb(r.amountObj)}</td>
                            <td>${r.descripcion}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = html;
}

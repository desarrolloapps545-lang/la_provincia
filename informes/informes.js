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

window.exportCurrentTableToExcel = function(fileName, sheetName) {
    const activeTable = document.querySelector('.view-section:not(.hidden) .table-container table');
    if (!activeTable) {
        showToast('No se encontró una tabla visible para exportar', 'error');
        return;
    }

    const rows = Array.from(activeTable.querySelectorAll('tbody tr'));
    if (!rows.length) {
        showToast('No hay datos para exportar', 'error');
        return;
    }

    const headers = Array.from(activeTable.querySelectorAll('thead th')).map(th => th.textContent.trim());
    const data = rows.map(tr => Array.from(tr.querySelectorAll('td')).map(td => {
        const text = td.textContent.trim();
        return isNaN(text) ? text : Number(text.replace(/[^0-9.-]/g, ''));
    }));

    let finalData = [headers, ...data];

    const activeContainer = document.querySelector('.view-section:not(.hidden) .table-container');
    if (activeContainer) {
        const cards = activeContainer.querySelectorAll('.resumen-card');
        if (cards.length) {
            const resumenRows = [['Resumen']];
            let hasResumen = false;
            cards.forEach(card => {
                const label = card.querySelector('.resumen-label')?.textContent.trim();
                const value = card.querySelector('.resumen-value')?.textContent.trim();
                if (label && value) {
                    resumenRows.push([label, value]);
                    hasResumen = true;
                }
            });
            if (hasResumen) {
                resumenRows.push([]);
                finalData = [...resumenRows, headers, ...data];
            }
        }
    }

    const ws = XLSX.utils.aoa_to_sheet(finalData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Informe');
    XLSX.writeFile(wb, fileName);
};

function switchView(viewId) {
    document.getElementById('welcomeInformes').classList.add('hidden');
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
}

document.getElementById('btnInformeGanancias')?.addEventListener('click', () => {
    switchView('informeGananciasView');
    loadProductFilters('gananciasProductSelect');
});

document.getElementById('btnInformeCompras')?.addEventListener('click', () => {
    switchView('informeComprasView');
    loadProductFilters('comprasProductSelect');
});

document.getElementById('btnInformeVentas')?.addEventListener('click', () => {
    switchView('informeVentasView');
    loadProductFilters('ventasProductSelect');
});

document.getElementById('btnInformePeso')?.addEventListener('click', () => {
    switchView('informePesoView');
    loadProductFilters('pesoProductSelect');
});

async function loadProductFilters(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const { data } = await _supabase.from('products').select('name').eq('inventory', true).order('name');
    const unique = [...new Set((data || []).map(p => p.name))];
    select.innerHTML = '<option value="todos">Todos</option>' +
        unique.map(p => `<option value="${p}">${p}</option>`).join('');
}

// ==========================================
// INFORME DE GANANCIAS
// ==========================================
async function generarInformeGanancias() {
    const container = document.getElementById('gananciasResultContainer');
    const start = document.getElementById('gananciasDateStart').value;
    const end = document.getElementById('gananciasDateEnd').value;
    const producto = document.getElementById('gananciasProductSelect').value;

    container.innerHTML = '<p style="padding: 20px; text-align: center;">Cargando datos...</p>';

    const [salesRes, buysRes] = await Promise.all([
        _supabase.from('sales').select('products, products_value, amount, medit, created_at, total_to_pay, invoice_number').order('created_at', { ascending: true }),
        _supabase.from('buys').select('product, product_value, amount, medit, created_at, total_payed, invoice_number').order('created_at', { ascending: true })
    ]);

    if (salesRes.error) {
        container.innerHTML = `<p style="padding: 20px; color: #d63031;">Error al cargar ventas: ${salesRes.error.message}</p>`;
        return;
    }
    if (buysRes.error) {
        container.innerHTML = `<p style="padding: 20px; color: #d63031;">Error al cargar compras: ${buysRes.error.message}</p>`;
        return;
    }

    const toNumber = (v) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : 0;
    };

    const getProductAmount = (item) => {
        const total = item.total_to_pay || item.total_payed || 0;
        return toNumber(total);
    };

    const filtrarPorFecha = (items) => {
        return items.filter(item => {
            const fecha = item.created_at ? item.created_at.split(' ')[0] : '';
            if (start && fecha < start) return false;
            if (end && fecha > end) return false;
            return true;
        });
    };

    const filtrarPorProducto = (item) => {
        if (!producto || producto === 'todos') return true;
        const productos = Array.isArray(item.products) ? item.products : (Array.isArray(item.product) ? item.product : []);
        return productos.includes(producto);
    };

    const ventasFiltradas = filtrarPorFecha(salesRes.data || []).filter(filtrarPorProducto);
    const comprasFiltradas = filtrarPorFecha(buysRes.data || []).filter(filtrarPorProducto);

    if (ventasFiltradas.length === 0 && comprasFiltradas.length === 0) {
        container.innerHTML = '<p style="padding: 20px; text-align: center; color: #636e72;">No hay datos para el rango seleccionado</p>';
        return;
    }

    const groups = {};
    let totalVentas = 0;
    let totalCompras = 0;

    ventasFiltradas.forEach(s => {
        const fecha = s.created_at ? s.created_at.split(' ')[0] : '';
        const timestamp = s.created_at || '';
        const productos = Array.isArray(s.products) ? s.products : [];
        
        productos.forEach((nombre) => {
            const key = `${nombre}|${fecha}`;
            if (!groups[key]) groups[key] = { producto: nombre, fecha: timestamp, venta: 0, compra: 0 };
            const valor = parseFloat(getProductAmount(s).toFixed(3));
            groups[key].venta = parseFloat((groups[key].venta + valor).toFixed(3));
            totalVentas = parseFloat((totalVentas + valor).toFixed(3));
        });
    });

    comprasFiltradas.forEach(c => {
        const fecha = c.created_at ? c.created_at.split(' ')[0] : '';
        const timestamp = c.created_at || '';
        const productos = Array.isArray(c.product) ? c.product : [];
        productos.forEach((nombre) => {
            const key = `${nombre}|${fecha}`;
            if (!groups[key]) groups[key] = { producto: nombre, fecha: timestamp, venta: 0, compra: 0 };
            const valor = parseFloat(getProductAmount(c).toFixed(3));
            groups[key].compra = parseFloat((groups[key].compra + valor).toFixed(3));
            totalCompras = parseFloat((totalCompras + valor).toFixed(3));
        });
    });

    const rows = Object.values(groups).map(g => ({
        producto: g.producto,
        fecha: g.fecha,
        venta: g.venta,
        compra: g.compra
    }));

    rows.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || a.producto.localeCompare(b.producto));

    const gananciaNeta = totalVentas - totalCompras;

    const html = `
        <div style="padding: 20px;">
            <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; justify-content: center;">
                <div class="resumen-card positivo">
                    <div class="resumen-label">Total Ventas</div>
                    <div class="resumen-value">$ ${formatNumber(totalVentas)}</div>
                </div>
                <div class="resumen-card negativo">
                    <div class="resumen-label">Total Compras</div>
                    <div class="resumen-value">$ ${formatNumber(totalCompras)}</div>
                </div>
                <div class="resumen-card ${gananciaNeta >= 0 ? 'positivo' : 'negativo'}">
                    <div class="resumen-label">Ganancia Total</div>
                    <div class="resumen-value">$ ${formatNumber(gananciaNeta)}</div>
                </div>
            </div>

            <h4 style="margin-bottom: 15px; color: #2d3436;">Ventas y Compras por Producto y Fecha</h4>
            ${rows.length > 0 ? `
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th>Fecha</th>
                                <th>Venta</th>
                                <th>Compra</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(r => `
                                <tr>
                                    <td>${r.producto}</td>
                                    <td>${format12h(r.fecha)}</td>
                                    <td style="color: #00b894; font-weight: bold;">$ ${formatNumber(r.venta)}</td>
                                    <td style="color: #d63031; font-weight: bold;">$ ${formatNumber(r.compra)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
             ` : '<p style="color: #636e72;">No hay datos para el rango seleccionado</p>'}
        </div>
    `;

    container.innerHTML = html;
    document.getElementById('btnDescargarGanancias')?.classList.toggle('hidden', rows.length === 0);
}

// ==========================================
// INFORME DE COMPRAS
// ==========================================
async function generarInformeCompras() {
    const container = document.getElementById('comprasResultContainer');
    const start = document.getElementById('comprasDateStart').value;
    const end = document.getElementById('comprasDateEnd').value;
    const producto = document.getElementById('comprasProductSelect').value;

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
    if (producto && producto !== 'todos') filtered = filtered.filter(b => (Array.isArray(b.product) ? b.product : []).includes(producto));

    if (filtered.length === 0) {
        container.innerHTML = '<p style="padding: 20px; text-align: center; color: #636e72;">No hay datos para el rango seleccionado</p>';
        return;
    }

    const rows = filtered.map(buy => {
        const productos = buy.product || [];
        const valores = buy.product_value || [];
        // Normaliza 'medit' para que siempre sea un array de strings, incluso si viene como un string JSON.
        let medits = [];
        try {
            medits = typeof buy.medit === 'string' ? JSON.parse(buy.medit) : (buy.medit || []);
            if (!Array.isArray(medits)) medits = [medits];
        } catch (e) {
            medits = Array.isArray(buy.medit) ? buy.medit : [buy.medit];
        }
        const proveedores = buy.provider || [];
        const total = buy.total_payed || 0;

        const productosDetalle = productos.map((p, i) => `${p}`).join(', ');

        const preciosDetalle = valores.map((val, i) => {
            const unit = (Array.isArray(medits) ? medits[i] : medits) || 'KG';
            return `$ ${formatNumber(val)} / ${unit || 'Unidad'}`;
        }).join('<br>');

        const cantidades = (buy.amount && Array.isArray(buy.amount))
            ? buy.amount.map(amt => {
                if (amt && typeof amt === 'object' && Object.keys(amt).length > 0) {
                    return Object.entries(amt).map(([k, v]) => `${formatNumber(v)} ${k}`).join('<br>');
                }
                return '-';
            }).join('<br>')
            : '-';

        return {
            factura: buy.invoice_number,
            fecha: format12h(buy.created_at),
            proveedores: [...new Set(proveedores)].join(', '),
            productos: productosDetalle || '-',
            precios: preciosDetalle,
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
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>No. Factura</th>
                            <th>Fecha</th>
                            <th>Proveedores</th>
                            <th>Productos</th>
                            <th>Precio</th>
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
                                <td>${r.precios}</td>
                                <td>${r.cantidades}</td>
                                <td>$ ${formatNumber(r.total)}</td>
                                <td>${r.metodo}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    container.innerHTML = html;
    document.getElementById('btnDescargarCompras')?.classList.toggle('hidden', rows.length === 0);
}

// ==========================================
// INFORME DE VENTAS
// ==========================================
async function generarInformeVentas() {
    const container = document.getElementById('ventasResultContainer');
    const start = document.getElementById('ventasDateStart').value;
    const end = document.getElementById('ventasDateEnd').value;
    const producto = document.getElementById('ventasProductSelect').value;

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
    if (producto && producto !== 'todos') filtered = filtered.filter(s => (Array.isArray(s.products) ? s.products : []).includes(producto));

    if (filtered.length === 0) {
        container.innerHTML = '<p style="padding: 20px; text-align: center; color: #636e72;">No hay datos para el rango seleccionado</p>';
        return;
    }

    const rows = filtered.map(sale => {
        const productos = sale.products || [];
        const valores = sale.products_value || [];
        // Normaliza 'medit' para que siempre sea un array de strings.
        let medits = [];
        try {
            medits = typeof sale.medit === 'string' ? JSON.parse(sale.medit) : (sale.medit || []);
            if (!Array.isArray(medits)) medits = [medits];
        } catch (e) {
            medits = Array.isArray(sale.medit) ? sale.medit : [sale.medit];
        }
        const productosDetalle = productos.map((p, i) => `${p}`).join(', ');

        const preciosDetalle = valores.map((val, i) => {
            const unit = (Array.isArray(medits) ? medits[i] : medits) || 'KG';
            return `$ ${formatNumber(val)} / ${unit || 'Unidad'}`;
        }).join('<br>');

        const cantidades = (sale.amount && Array.isArray(sale.amount))
            ? sale.amount.map(amt => {
                if (amt && typeof amt === 'object' && Object.keys(amt).length > 0) {
                    return Object.entries(amt).map(([k, v]) => `${formatNumber(v)} ${k}`).join('<br>');
                }
                return '-';
            }).join('<br>')
            : '-';
        return {
            factura: sale.invoice_number,
            fecha: format12h(sale.created_at),
            cliente: sale.client,
            productos: productosDetalle || '-',
            precios: preciosDetalle,
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
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>No. Factura</th>
                            <th>Fecha</th>
                            <th>Cliente</th>
                            <th>Granja</th>
                            <th>Productos</th>
                            <th>Precio</th>
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
                                <td>${r.precios}</td>
                                <td>${r.cantidades}</td>
                                <td>$ ${formatNumber(r.total)}</td>
                                <td>${r.metodo}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    container.innerHTML = html;
    document.getElementById('btnDescargarVentas')?.classList.toggle('hidden', rows.length === 0);
}

// ==========================================
// INFORME DE PESO DE ENTRADA Y SALIDA
// ==========================================
async function generarInformePeso() {
    const container = document.getElementById('pesoResultContainer');
    const producto = document.getElementById('pesoProductSelect').value;
    const start = document.getElementById('pesoDateStart').value;
    const end = document.getElementById('pesoDateEnd').value;

    container.innerHTML = '<p style="padding: 20px; text-align: center;">Cargando datos...</p>';

    let query = _supabase
        .from('movements')
        .select('*')
        .order('created_at', { ascending: true });

    const { data: movements, error } = await query;

    if (error) {
        container.innerHTML = `<p style="padding: 20px; color: #d63031;">Error: ${error.message}</p>`;
        return;
    }

    let filtered = movements || [];
    if (producto && producto !== 'todos') {
        filtered = filtered.filter(m => m.name === producto);
    }
    if (start) filtered = filtered.filter(m => {
        const fecha = (m.date_movement || m.created_at || '').split(' ')[0];
        return fecha >= start;
    });
    if (end) filtered = filtered.filter(m => {
        const fecha = (m.date_movement || m.created_at || '').split(' ')[0];
        return fecha <= end;
    });

    // El saldo debe incluir movimientos anteriores al inicio del filtro.
    let balanceMovements = movements || [];
    if (producto && producto !== 'todos') {
        balanceMovements = balanceMovements.filter(m => m.name === producto);
    }
    if (end) balanceMovements = balanceMovements.filter(m => {
        const fecha = (m.date_movement || m.created_at || '').split(' ')[0];
        return fecha <= end;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<p style="padding: 20px; text-align: center; color: #636e72;">No hay movimientos para el filtro seleccionado</p>';
        return;
    }

    const groups = {};
    let totalEntrada = 0;
    let totalSalida = 0;

    balanceMovements.forEach(m => {
        const esIngreso = m.type === 'ingreso' || m.type === 'ingreso_animal';
        const fecha = (m.date_movement || m.created_at || '').split(' ')[0];
        const key = `${m.name}|${fecha}`;

        if (!groups[key]) {
            groups[key] = { producto: m.name, fecha, entrada: {}, salida: {} };
        }

        const amountObj = filterAmountByType(normalizeAmount(m.amount), 'peso');
        const target = esIngreso ? groups[key].entrada : groups[key].salida;

        Object.entries(amountObj).forEach(([medida, valor]) => {
            target[medida] = parseFloat(((target[medida] || 0) + valor).toFixed(3));
            if (esIngreso) totalEntrada = parseFloat((totalEntrada + valor).toFixed(3));
            else totalSalida = parseFloat((totalSalida + valor).toFixed(3));
        });
    });

    const saldoPorProducto = {};
    const rows = Object.values(groups).sort((a, b) => a.fecha.localeCompare(b.fecha)).map(g => {
        const medidas = [...new Set([...Object.keys(g.entrada), ...Object.keys(g.salida)])];
        const saldoObj = {};
        if (!saldoPorProducto[g.producto]) saldoPorProducto[g.producto] = {};
        medidas.forEach(m => {
            const ent = g.entrada[m] || 0;
            const sal = g.salida[m] || 0;
            const saldoAnterior = saldoPorProducto[g.producto][m] || 0;
            const saldoActual = parseFloat((saldoAnterior + ent - sal).toFixed(3));
            saldoPorProducto[g.producto][m] = saldoActual;
            if (saldoActual !== 0) saldoObj[m] = saldoActual;
        });
        return {
            producto: g.producto,
            fecha: g.fecha,
            entrada: formatAmountJsonb(g.entrada) || '-',
            salida: formatAmountJsonb(g.salida) || '-',
            saldo: formatAmountJsonb(saldoObj) || '-'
        };
    }).filter(row => !start || row.fecha >= start);

    rows.sort((a, b) => a.fecha.localeCompare(b.fecha));

    const html = `
        <div style="padding: 20px;">
            <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; justify-content: center;">
                <div class="resumen-card positivo">
                    <div class="resumen-label">Total Entradas</div>
                    <div class="resumen-value">${formatNumber(totalEntrada)} kg</div>
                </div>
                <div class="resumen-card negativo">
                    <div class="resumen-label">Total Salidas</div>
                    <div class="resumen-value">${formatNumber(totalSalida)} kg</div>
                </div>
                <div class="resumen-card ${(totalEntrada - totalSalida) >= 0 ? 'positivo' : 'negativo'}">
                    <div class="resumen-label">Saldo</div>
                    <div class="resumen-value">${formatNumber(parseFloat((totalEntrada - totalSalida).toFixed(3)))} kg</div>
                </div>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Producto</th>
                            <th>Fecha</th>
                            <th>Entrada</th>
                            <th>Salida</th>
                            <th>Saldo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr>
                                <td>${r.producto}</td>
                                <td>${r.fecha}</td>
                                <td style="color: #00b894; font-weight: bold;">${r.entrada}</td>
                                <td style="color: #d63031; font-weight: bold;">${r.salida}</td>
                                <td class="text-saldo">${r.saldo}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    container.innerHTML = html;
    document.getElementById('btnDescargarPeso')?.classList.toggle('hidden', rows.length === 0);
}

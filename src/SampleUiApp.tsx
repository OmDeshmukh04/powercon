import sampleHtml from '../../sample/UI_enhanced_v2.html?raw';

export default function SampleUiApp() {
  const injected = `
<script>
// CapSurge Backend Integration - Direct Window Setup
window.API_BASE = 'http://localhost:8000';
window.TOKEN_KEY = 'token';
window.TENANT_ID = localStorage.getItem('tenant_id') || 'TNT-DEFAULT';

console.log('[CapSurge] Backend integration loaded');

// API request wrapper with token support
window.apiRequest = async function(method, path, body, params) {
  const url = new URL(window.API_BASE + path);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      url.searchParams.set(k, String(v));
    });
  }
  
  const token = localStorage.getItem(window.TOKEN_KEY);
  const headers = { 
    'Content-Type': 'application/json',
    'X-Tenant-Id': window.TENANT_ID
  };
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
  }
  
  const init = { method: method || 'GET', headers };
  if (body) {
    init.body = JSON.stringify(body);
  }
  
  console.log('[CapSurge API] ' + method + ' ' + url.toString());
  const res = await fetch(url.toString(), init);
  const text = await res.text();
  let data;
  try { 
    data = text ? JSON.parse(text) : null; 
  } catch { 
    data = text; 
  }
  
  if (!res.ok) {
    const msg = (data && (data.detail?.message || data.detail || data.message)) || res.statusText || 'Request failed';
    throw new Error(msg);
  }
  return data;
};

// API shortcuts
window.apiGet = (path, params) => window.apiRequest('GET', path, null, params);
window.apiPost = (path, body, params) => window.apiRequest('POST', path, body, params);
window.apiDelete = (path) => window.apiRequest('DELETE', path, null, null);

// Helper: Format numbers with commas
window.fmt = function(n) {
  try { return Number(n).toLocaleString(); } catch { return String(n); }
};

// Helper: Format currency
window.money = function(n) {
  const v = Number(n || 0);
  try { return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
  catch { return '$' + v; }
};

// Populate providers dropdown with real data from API
window.populateProviders = async function() {
  const sel = document.getElementById('op-prov-filter');
  if (!sel) {
    console.log('[CapSurge] Provider dropdown not found');
    return;
  }
  
  try {
    console.log('[CapSurge] Fetching providers...');
    const data = await window.apiGet('/v1/providers', {});
    const providers = data?.providers || [];
    console.log('[CapSurge] Got', providers.length, 'providers');
    
    sel.innerHTML = '<option value="">All Providers</option>';
    for (const p of providers) {
      const opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = p.name;
      sel.appendChild(opt);
    }
  } catch (err) {
    console.error('[CapSurge] Provider fetch failed:', err.message);
  }
};

// Load and display appointments
window.refreshAppointments = async function() {
  try {
    console.log('[CapSurge] Loading appointments...');
    
    // Get filter values
    const fromEl = document.getElementById('op-date-from');
    const toEl = document.getElementById('op-date-to');
    const provEl = document.getElementById('op-prov-filter');
    
    const params = {
      start_date: fromEl?.value || undefined,
      end_date: toEl?.value || undefined,
      provider_id: provEl?.value || undefined,
      page: 1,
      page_size: 50,
    };
    
    const data = await window.apiGet('/v1/appointments', params);
    const appointments = data?.appointments || [];
    
    console.log('[CapSurge] Got', appointments.length, 'appointments');
    
    // Update KPIs
    const total = appointments.length;
    const checkedOut = appointments.filter(a => (a.status || '').toLowerCase().includes('check')).length;
    const noshow = appointments.filter(a => (a.status || '').toLowerCase().includes('no-show')).length;
    const cancelled = appointments.filter(a => (a.status || '').toLowerCase().includes('cancel')).length;
    
    try { document.getElementById('kpi-total').textContent = window.fmt(total); } catch {}
    try { document.getElementById('kpi-checkout').textContent = window.fmt(checkedOut); } catch {}
    try { document.getElementById('kpi-noshow').textContent = window.fmt(noshow); } catch {}
    try { document.getElementById('kpi-cancelled').textContent = window.fmt(cancelled); } catch {}
    
    // Update table
    const tbody = document.getElementById('op-tbody');
    if (tbody) {
      tbody.innerHTML = '';
      const rows = appointments.slice(0, 50);
      for (const a of rows) {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td class="bold">' + (a.patient_name || '—') + '</td>' +
          '<td class="t-muted">' + (a.provider_name || '—') + '</td>' +
          '<td>' + (a.appt_date || '—') + '</td>' +
          '<td class="t-muted">' + (a.start_time || '—') + '</td>' +
          '<td class="mono">' + (a.ticket_number || '—') + '</td>' +
          '<td><span class="badge bg-blue">• ' + (a.status || '—') + '</span></td>' +
          '<td class="t-muted mono">' + (a.patient_id || '—') + '</td>';
        tbody.appendChild(tr);
      }
    }
    
    // Update table subtitle
    const sub = document.getElementById('op-table-sub');
    if (sub) sub.textContent = 'Showing ' + Math.min(50, appointments.length) + ' of ' + window.fmt(total) + ' appointments';
    
  } catch (err) {
    console.error('[CapSurge] Appointment fetch failed:', err.message);
  }
};

// Load financial data
window.refreshFinancial = async function() {
  try {
    console.log('[CapSurge] Loading financial data...');
    
    const fromEl = document.getElementById('fin-date-from');
    const toEl = document.getElementById('fin-date-to');
    const provEl = document.getElementById('fin-prov-filter');
    
    const params = {
      start_date: fromEl?.value || undefined,
      end_date: toEl?.value || undefined,
      provider_id: provEl?.value || undefined,
    };
    
    // Get summary
    const summary = await window.apiGet('/v1/reconciliation/summary', params);
    const totals = summary?.totals || {};
    
    // Update KPIs
    const kpiVals = document.querySelectorAll('#page-fin-dashboard .kpi-row.cols3 .kpi-val');
    if (kpiVals && kpiVals.length >= 3) {
      kpiVals[0].textContent = window.money(totals.billed);
      kpiVals[1].textContent = window.money(totals.paid);
      kpiVals[2].textContent = window.money(totals.balance);
    }
    
    // Get results
    const rowsRes = await window.apiGet('/v1/reconciliation/results', {
      ...params,
      page: 1,
      page_size: 20,
    });
    
    const rows = rowsRes?.results || rowsRes?.items || [];
    
    // Update table
    const tbody = document.getElementById('fin-tbody');
    if (tbody) {
      tbody.innerHTML = '';
      for (const r of rows) {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td class="bold">' + (r.patient_name || '—') + '</td>' +
          '<td class="t-muted">' + (r.provider_name || '—') + '</td>' +
          '<td class="mono">' + (r.service_date || r.appt_date || '—') + '</td>' +
          '<td class="mono">' + window.money(r.billed_amount || 0) + '</td>' +
          '<td class="mono">' + window.money(r.paid_amount || 0) + '</td>' +
          '<td class="mono">' + window.money(r.balance_amount || 0) + '</td>' +
          '<td><span class="badge bg-blue">• ' + (r.recon_status || r.status || '—') + '</span></td>';
        tbody.appendChild(tr);
      }
    }
    
  } catch (err) {
    console.error('[CapSurge] Financial fetch failed:', err.message);
  }
};

// Wire up filter events
window.wireFilterEvents = function() {
  console.log('[CapSurge] Wiring filter events...');
  
  // Appointments filters
  const filterIds = ['op-date-from', 'op-date-to', 'op-prov-filter', 'op-status-filter', 'op-view-sel'];
  filterIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      console.log('[CapSurge] Filter changed:', id);
      window.refreshAppointments().catch(e => console.error('[CapSurge] Refresh failed:', e));
    });
  });
  
  // Apply button
  const applyBtn = Array.from(document.querySelectorAll('button')).find(b => 
    (b.textContent || '').toLowerCase().includes('apply') && (b.className || '').includes('accent')
  );
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      console.log('[CapSurge] Apply button clicked');
      window.refreshAppointments().catch(e => console.error('[CapSurge] Refresh failed:', e));
    });
  }
  
  // Clear button
  const clearBtn = Array.from(document.querySelectorAll('button')).find(b => 
    (b.textContent || '').includes('✕')
  );
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      console.log('[CapSurge] Clear button clicked');
      const els = ['op-date-from', 'op-date-to', 'op-prov-filter', 'op-status-filter'];
      els.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      window.refreshAppointments().catch(e => console.error('[CapSurge] Refresh failed:', e));
    });
  }
  
  // Financial filters
  const finFilterIds = ['fin-date-from', 'fin-date-to', 'fin-prov-filter', 'fin-status-filter'];
  finFilterIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      window.refreshFinancial().catch(e => console.error('[CapSurge] Refresh failed:', e));
    });
  });
};


// Real login using backend
window.doLoginReal = async function() {
  const emailEl = document.getElementById('l-email');
  const passEl = document.getElementById('l-pass');
  const email = emailEl?.value || '';
  const password = passEl?.value || '';
  
  if (!email || !password) {
    throw new Error('Please enter email and password');
  }
  
  console.log('[CapSurge LOGIN] Authenticating:', email);
  const res = await window.apiPost('/v1/auth/login', { email, password });
  console.log('[CapSurge LOGIN] Response:', res);
  
  const token = res?.data?.token;
  if (!token) {
    throw new Error('Login failed: no token returned');
  }
  
  localStorage.setItem(window.TOKEN_KEY, token);
  console.log('[CapSurge LOGIN] Token saved successfully');
  
  // Load user data
  const me = await window.apiGet('/v1/auth/me');
  console.log('[CapSurge LOGIN] User loaded:', me?.email);
  
  // Update UI
  const loginPage = document.getElementById('login-page');
  const app = document.getElementById('app');
  if (loginPage) loginPage.style.display = 'none';
  if (app) app.style.display = 'block';
  
  // Set user display
  const name = me?.full_name || me?.email || 'User';
  const initials = name.split(' ').filter(p => p.length > 0).map(p => p[0]).join('').toUpperCase() || 'US';
  
  try { document.getElementById('nb-uname').textContent = name; } catch {}
  try { document.getElementById('nb-av').textContent = initials; } catch {}
  try { document.getElementById('nb-urole').textContent = (me?.role || 'User'); } catch {}
  
// Real login using backend
window.doLoginReal = async function() {
  const emailEl = document.getElementById('l-email');
  const passEl = document.getElementById('l-pass');
  const email = emailEl?.value || '';
  const password = passEl?.value || '';
  
  if (!email || !password) {
    throw new Error('Please enter email and password');
  }
  
  console.log('[CapSurge LOGIN] Authenticating:', email);
  const res = await window.apiPost('/v1/auth/login', { email, password });
  console.log('[CapSurge LOGIN] Response:', res);
  
  const token = res?.data?.token;
  if (!token) {
    throw new Error('Login failed: no token returned');
  }
  
  localStorage.setItem(window.TOKEN_KEY, token);
  console.log('[CapSurge LOGIN] Token saved successfully');
  
  // Load user data
  const me = await window.apiGet('/v1/auth/me');
  console.log('[CapSurge LOGIN] User loaded:', me?.email);
  
  // Update UI
  const loginPage = document.getElementById('login-page');
  const app = document.getElementById('app');
  if (loginPage) loginPage.style.display = 'none';
  if (app) app.style.display = 'block';
  
  // Set user display
  const name = me?.full_name || me?.email || 'User';
  const initials = name.split(' ').filter(p => p.length > 0).map(p => p[0]).join('').toUpperCase() || 'US';
  
  try { document.getElementById('nb-uname').textContent = name; } catch {}
  try { document.getElementById('nb-av').textContent = initials; } catch {}
  try { document.getElementById('nb-urole').textContent = (me?.role || 'User'); } catch {}
  
  // Load data
  console.log('[CapSurge LOGIN] Loading dashboard data...');
  try {
    await window.populateProviders();
    await window.refreshAppointments();
    await window.refreshFinancial();
    window.wireFilterEvents();
  } catch (err) {
    console.error('[CapSurge LOGIN] Error loading data:', err.message);
  }
  
  console.log('[CapSurge LOGIN] Login complete');
};

// Override demo login
window.doLogin = function() {
  console.log('[CapSurge] doLogin called - redirecting to real backend');
  window.doLoginReal().catch(err => {
    console.error('[CapSurge ERROR]', err.message);
    try { if (window.showToast) window.showToast(err.message, 'err'); } catch {}
  });
};

// Login form submission handler
document.addEventListener('submit', function(e) {
  if (e.target && e.target.querySelector('.lf-btn')) {
    console.log('[CapSurge] Form submission intercepted');
    e.preventDefault();
    window.doLoginReal().catch(err => {
      console.error('[CapSurge ERROR]', err.message);
    });
  }
}, true);

// Login button click handler
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.lf-btn');
  if (!btn) return;
  
  console.log('[CapSurge] Login button clicked');
  e.preventDefault();
  e.stopPropagation();
  window.doLoginReal().catch(err => {
    console.error('[CapSurge ERROR]', err.message);
  });
}, true);

console.log('[CapSurge] Backend integration complete - ready for login');
</script>
  `;

  const html = sampleHtml.includes('</body>')
    ? sampleHtml.replace('</body>', injected + '\n</body>')
    : sampleHtml + injected;

  return (
    <iframe
      title="CapSurge Sample UI"
      srcDoc={html}
      style={{
        width: '100vw',
        height: '100vh',
        border: 'none',
        display: 'block',
      }}
    />
  );
}

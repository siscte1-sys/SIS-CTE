// ==================== CONFIGURACIÓN FIREBASE ====================
// Reemplaza estos valores con los de tu proyecto
const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_ID",
  appId: "TU_APP_ID"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();

// ==================== ESTADO GLOBAL ====================
let currentUser = null;
let xlsxFile    = null;  // Archivo Excel (obligatorio)
let informeFile = null;  // Informe de Entrega (obligatorio)
let actaFile    = null;  // Informativo de Atraso (obligatorio solo >día 10)

// ==================== UTILIDADES ====================
function showToast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || '•'}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, duration);
}

function getDiaMes() {
  return new Date().getDate();
}

function getNombreMes() {
  const meses = ['enero','febrero','marzo','abril','mayo','junio',
                 'julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const now = new Date();
  return `${meses[now.getMonth()]} de ${now.getFullYear()}`;
}

function pasoDia10() {
  return getDiaMes() > 10;
}

function diasParaDia10() {
  const dia = getDiaMes();
  return dia <= 10 ? (10 - dia) : 0;
}

// ==================== DARK MODE ====================
function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('darkMode', isDark);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = isDark ? '☀️ MODO CLARO' : '🌙 MODO OSCURO';
}

function initTheme() {
  const saved = localStorage.getItem('darkMode');
  if (saved === 'true') {
    document.body.classList.add('dark-mode');
    const btn = document.getElementById('theme-btn');
    if (btn) btn.textContent = '☀️ MODO CLARO';
  }
}

// ==================== AUTENTICACIÓN (Google) ====================
function loginConGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider)
    .then(result => entrarAlSistema(result.user))
    .catch(err => {
      console.error(err);
      showToast('Error al iniciar sesión: ' + err.message, 'error');
    });
}

function doLogout() {
  firebase.auth().signOut().then(() => {
    currentUser = null;
    document.getElementById('screen-login').style.display = 'flex';
    document.getElementById('screen-main').style.display  = 'none';
  });
}

function entrarAlSistema(user) {
  currentUser = user;
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('screen-main').style.display  = 'block';
  document.getElementById('display-user').textContent = user.displayName || user.email;
  renderEnvioForm();
  renderHistorial();
}

firebase.auth().onAuthStateChanged(user => {
  if (user) entrarAlSistema(user);
});

// ==================== PANEL DE CONTROL (STATS) ====================
async function renderStats() {
  try {
    const snap = await db.collection('envios').get();
    const total = snap.size;
    const conActa = snap.docs.filter(d => d.data().actaUrl).length;
    document.getElementById('stat-total').textContent  = total;
    document.getElementById('stat-acta').textContent   = conActa;
    document.getElementById('stat-sin-acta').textContent = total - conActa;
  } catch(e) { /* sin conexión */ }
}

// ==================== FORMULARIO DE ENVÍO ====================
function renderEnvioForm() {
  const dia  = getDiaMes();
  const mes  = getNombreMes();
  const tard = pasoDia10();

  // Aviso Informativo de Atraso
  const avisoEl = document.getElementById('aviso-dias');
  if (tard) {
    avisoEl.textContent = `⚠️ Ya pasó el día 10 — el Informativo de Atraso es OBLIGATORIO`;
    avisoEl.className   = 'aviso-dias urgente';
  } else {
    const faltan = diasParaDia10();
    avisoEl.textContent = faltan === 0
      ? `⚠️ Hoy es el día 10 — último día sin Informativo de Atraso`
      : `✔ Te quedan ${faltan} días sin Informativo de Atraso`;
    avisoEl.className   = faltan <= 2 ? 'aviso-dias urgente' : 'aviso-dias ok';
  }

  // Mostrar u ocultar badge del Informativo de Atraso
  const badgeActa = document.getElementById('badge-acta');
  if (tard) {
    badgeActa.textContent = 'OBLIGATORIO';
    badgeActa.className   = 'badge-req obligatorio';
  } else {
    const faltan = diasParaDia10();
    badgeActa.textContent = `OPCIONAL HASTA EL DÍA 10`;
    badgeActa.className   = 'badge-req opcional';
  }

  // Título del mes en curso
  document.getElementById('mes-envio').textContent = `Envío del reporte de ${mes}`;

  updateBotonEnvio();
  renderStats();
}

// ==================== LÓGICA DE ARCHIVOS ====================

// --- Excel ---
function setupZonaExcel() {
  setupZona('zona-excel', 'input-excel', ['.xlsx','.xls'], (file) => {
    xlsxFile = file;
    mostrarArchivoSeleccionado('excel', file.name);
    updateBotonEnvio();
  });
}

// --- Informe de Entrega ---
function setupZonaInforme() {
  setupZona('zona-informe', 'input-informe', ['.pdf'], (file) => {
    informeFile = file;
    mostrarArchivoSeleccionado('informe', file.name);
    updateBotonEnvio();
  });
}

// --- Informativo de Atraso ---
function setupZonaActa() {
  setupZona('zona-acta', 'input-acta', ['.pdf'], (file) => {
    actaFile = file;
    mostrarArchivoSeleccionado('acta', file.name);
    updateBotonEnvio();
  });
}

function setupZona(zonaId, inputId, accept, onFile) {
  const zona  = document.getElementById(zonaId);
  const input = document.getElementById(inputId);

  if (!zona || !input) return;

  input.setAttribute('accept', accept.join(','));

  input.addEventListener('change', () => {
    const f = input.files[0];
    if (f && validarExtension(f.name, accept)) {
      onFile(f);
      zona.classList.add('has-file');
      zona.classList.remove('error-zone');
    } else if (f) {
      showToast(`Solo se aceptan archivos: ${accept.join(', ')}`, 'error');
      input.value = '';
    }
  });

  zona.addEventListener('dragover',  e => { e.preventDefault(); zona.classList.add('drag-over'); });
  zona.addEventListener('dragleave', ()  => zona.classList.remove('drag-over'));
  zona.addEventListener('drop', e => {
    e.preventDefault();
    zona.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f && validarExtension(f.name, accept)) {
      onFile(f);
      zona.classList.add('has-file');
    } else if (f) {
      showToast(`Solo se aceptan archivos: ${accept.join(', ')}`, 'error');
    }
  });
}

function validarExtension(nombre, extensiones) {
  const lower = nombre.toLowerCase();
  return extensiones.some(ext => lower.endsWith(ext));
}

function mostrarArchivoSeleccionado(tipo, nombre) {
  const infoEl = document.getElementById(`info-${tipo}`);
  const nameEl = document.getElementById(`name-${tipo}`);
  if (infoEl) infoEl.classList.add('visible');
  if (nameEl) nameEl.textContent = nombre;
}

function quitarArchivo(tipo) {
  if (tipo === 'excel')   { xlsxFile    = null; document.getElementById('input-excel').value = ''; }
  if (tipo === 'informe') { informeFile = null; document.getElementById('input-informe').value = ''; }
  if (tipo === 'acta')    { actaFile    = null; document.getElementById('input-acta').value = ''; }

  const infoEl = document.getElementById(`info-${tipo}`);
  const zonaEl = document.getElementById(`zona-${tipo}`);
  if (infoEl) infoEl.classList.remove('visible');
  if (zonaEl) zonaEl.classList.remove('has-file');
  updateBotonEnvio();
}

// ==================== VALIDACIÓN Y BOTÓN ====================
function canEnviar() {
  const tieneExcel   = !!xlsxFile;
  const tieneInforme = !!informeFile;
  const tieneActa    = !!actaFile;
  const tard = pasoDia10();

  if (!tieneExcel)   return { ok: false, msg: 'Sube el archivo Excel para habilitar el envío' };
  if (!tieneInforme) return { ok: false, msg: 'Sube el Informe de Entrega para habilitar el envío' };
  if (tard && !tieneActa) return { ok: false, msg: 'Pasó el día 10 — el Informativo de Atraso es obligatorio' };
  return { ok: true, msg: '' };
}

function updateBotonEnvio() {
  const btn     = document.getElementById('btn-registrar');
  const hintEl  = document.getElementById('btn-hint');
  const result  = canEnviar();

  if (!btn) return;
  btn.disabled     = !result.ok;
  hintEl.textContent = result.ok ? '' : result.msg;
}

// ==================== REGISTRAR ENVÍO ====================
async function registrarEnvio() {
  const area = document.getElementById('select-area')?.value;
  if (!area) { showToast('Selecciona tu área', 'error'); return; }

  const { ok, msg } = canEnviar();
  if (!ok) { showToast(msg, 'error'); return; }

  const btn = document.getElementById('btn-registrar');
  btn.disabled = true;
  btn.innerHTML = '⏳ REGISTRANDO...';

  try {
    const ts   = Date.now();
    const user = currentUser;
    const mes  = getNombreMes();
    const ref  = db.collection('envios').doc();

    // Subir Excel
    const excelRef = storage.ref(`envios/${ref.id}/excel_${xlsxFile.name}`);
    await excelRef.put(xlsxFile);
    const excelUrl = await excelRef.getDownloadURL();

    // Subir Informe de Entrega
    const informeRef = storage.ref(`envios/${ref.id}/informe_${informeFile.name}`);
    await informeRef.put(informeFile);
    const informeUrl = await informeRef.getDownloadURL();

    // Subir Informativo de Atraso (si existe)
    let actaUrl = null;
    if (actaFile) {
      const actaRef = storage.ref(`envios/${ref.id}/acta_${actaFile.name}`);
      await actaRef.put(actaFile);
      actaUrl = await actaRef.getDownloadURL();
    }

    // Guardar en Firestore
    await ref.set({
      area,
      mes,
      fechaEnvio: firebase.firestore.FieldValue.serverTimestamp(),
      usuario: user.email,
      nombreUsuario: user.displayName || user.email,
      excelNombre: xlsxFile.name,
      excelUrl,
      informeNombre: informeFile.name,
      informeUrl,
      actaNombre: actaFile ? actaFile.name : null,
      actaUrl,
      diaMes: getDiaMes(),
      tardio: pasoDia10(),
    });

    showToast('✅ Envío registrado correctamente', 'success');

    // Limpiar formulario
    xlsxFile = null; informeFile = null; actaFile = null;
    ['excel','informe','acta'].forEach(t => quitarArchivo(t));
    ['input-excel','input-informe','input-acta'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    renderHistorial();
    renderStats();

  } catch (err) {
    console.error(err);
    showToast('Error al registrar: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📤 REGISTRAR ENVÍO';
    updateBotonEnvio();
  }
}

// ==================== HISTORIAL ====================
async function renderHistorial() {
  const tbody = document.getElementById('historial-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--muted)">Cargando...</td></tr>';

  try {
    const snap = await db.collection('envios')
      .orderBy('fechaEnvio', 'desc')
      .limit(50)
      .get();

    if (snap.empty) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--muted)">Sin envíos registrados</td></tr>';
      return;
    }

    tbody.innerHTML = snap.docs.map(doc => {
      const d = doc.data();
      const fecha = d.fechaEnvio ? new Date(d.fechaEnvio.seconds * 1000).toLocaleDateString('es-EC', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
      let estado = '';
      if (d.actaUrl) estado = '<span class="badge badge-completo">Completo</span>';
      else if (d.tardio) estado = '<span class="badge badge-atrasado">Sin informativo</span>';
      else estado = '<span class="badge badge-sin-acta">Sin informe atraso</span>';

      return `<tr>
        <td>${esc(d.area || '—')}</td>
        <td>${esc(d.mes  || '—')}</td>
        <td>${fecha}</td>
        <td><a href="${d.excelUrl}" target="_blank" style="color:var(--gold)">📊 ${esc(d.excelNombre || 'Excel')}</a></td>
        <td><a href="${d.informeUrl}" target="_blank" style="color:var(--gold)">📄 ${esc(d.informeNombre || 'Informe')}</a></td>
        <td>${d.actaUrl ? `<a href="${d.actaUrl}" target="_blank" style="color:var(--gold)">📄 ${esc(d.actaNombre||'Acta')}</a>` : '<span style="color:var(--muted)">—</span>'}</td>
        <td>${estado}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--danger)">Error al cargar</td></tr>';
  }
}

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupZonaExcel();
  setupZonaInforme();
  setupZonaActa();
  renderEnvioForm();
});

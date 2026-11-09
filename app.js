/* GestVoltic no telemóvel e no tablet (v147). Funciona sem o PC e sem rede.
   Dados: o Voltic_movel.json que o programa do PC grava na pasta do OneDrive; aqui escolhe-se esse ficheiro em «Atualizar».
   Tudo fica guardado SÓ neste aparelho, cifrado com o PIN (AES-GCM; chave PBKDF2 do PIN). Nada é enviado para lado nenhum:
   as anotações saem só quando o Jorge carrega em «Guardar anotações» e escolhe a pasta do OneDrive. */
(() => {
  'use strict';
  const VERSAO = '164.1';
  const $ = s => document.querySelector(s);
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = v => (v == null || v === '' || isNaN(+v)) ? '—' : (+v).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
  const dpt = s => /^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : (s || '');
  const quando = iso => iso ? new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const sem = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const raiz = () => $('#raiz');

  /* ---------------------------------------------------------------- cofre (IndexedDB + WebCrypto) */
  const BD = 'gestvoltic', LOJA = 'kv';
  function abrirBD() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(BD, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(LOJA);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function ler(k) { const db = await abrirBD(); return new Promise((res, rej) => { const t = db.transaction(LOJA).objectStore(LOJA).get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
  async function gravar(k, v) { const db = await abrirBD(); return new Promise((res, rej) => { const t = db.transaction(LOJA, 'readwrite'); t.objectStore(LOJA).put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
  const enc = new TextEncoder(), dec = new TextDecoder();
  let CHAVE = null;
  async function derivar(pin, sal) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sal, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function cifrar(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, CHAVE, enc.encode(JSON.stringify(obj)));
    return { iv, c: new Uint8Array(c) };
  }
  async function decifrar(x) {
    const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: x.iv }, CHAVE, x.c);
    return JSON.parse(dec.decode(p));
  }

  /* ---------------------------------------------------------------- estado */
  let D = null;          // dados do PC (Voltic_movel.json)
  let N = [];            // anotações deste aparelho
  let aba = 'avisos', ecraExtra = null, filtroEstado = 'Ativas', procura = { p: '', c: '' };
  async function guardarDados() { await gravar('dados', await cifrar(D)); }
  async function guardarNotas() { await gravar('notas', await cifrar(N)); }

  /* ---------------------------------------------------------------- PIN */
  let falhas = 0, esperaAte = 0;
  async function inicio() {
    if (!window.isSecureContext || !crypto.subtle) {
      raiz().innerHTML = '<div class="centro"><h2>GestVoltic</h2><p class="erro">Esta página tem de ser aberta pelo endereço https (GitHub Pages), não como ficheiro.</p></div>';
      return;
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
    const meta = await ler('meta');
    if (!meta) return criarPin();
    pedirPin(meta);
  }
  function criarPin() {
    raiz().innerHTML = '<div class="centro cartao"><h2>GestVoltic</h2><p>Escolha um PIN para proteger os dados neste aparelho (4 a 8 algarismos).</p>' +
      '<input id="p1" type="password" inputmode="numeric" autocomplete="new-password" placeholder="PIN"><p></p><input id="p2" type="password" inputmode="numeric" placeholder="Repetir">' +
      '<p class="erro" id="er"></p><button class="btn" id="ok">Guardar PIN</button>' +
      '<p class="nota">Se esquecer o PIN, os dados deste aparelho deixam de abrir (volta a carregar o ficheiro do PC; as anotações ainda não guardadas perdem-se).</p></div>';
    $('#ok').onclick = async () => {
      const a = $('#p1').value, b = $('#p2').value;
      if (!/^\d{4,8}$/.test(a)) return $('#er').textContent = 'O PIN tem de ter 4 a 8 algarismos.';
      if (a !== b) return $('#er').textContent = 'Os dois PIN não são iguais.';
      const sal = crypto.getRandomValues(new Uint8Array(16));
      CHAVE = await derivar(a, sal);
      const teste = await cifrar({ ok: 'gestvoltic' });
      await gravar('meta', { sal, teste, criado: new Date().toISOString() });
      D = null; N = []; await guardarNotas();
      principal();
    };
  }
  function pedirPin(meta) {
    raiz().innerHTML = '<div class="centro cartao"><h2>GestVoltic</h2><p>PIN</p><input id="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus>' +
      '<p class="erro" id="er"></p><button class="btn" id="ok">Entrar</button></div>';
    const vai = async () => {
      if (Date.now() < esperaAte) return $('#er').textContent = 'Espere ' + Math.ceil((esperaAte - Date.now()) / 1000) + ' s.';
      try {
        CHAVE = await derivar($('#pin').value, meta.sal);
        const t = await decifrar(meta.teste);
        if (t.ok !== 'gestvoltic') throw new Error();
      } catch (_) {
        CHAVE = null; falhas++; if (falhas >= 5) { esperaAte = Date.now() + 30000; falhas = 0; }
        $('#pin').value = ''; return $('#er').textContent = 'PIN errado.';
      }
      try { const x = await ler('dados'); D = x ? await decifrar(x) : null; } catch (_) { D = null; }
      try { const x = await ler('notas'); N = x ? await decifrar(x) : []; } catch (_) { N = []; }
      try { const x = await ler('tecnico'); TEC = x ? await decifrar(x) : ''; } catch (_) { TEC = ''; }
      principal();
    };
    $('#ok').onclick = vai;
    $('#pin').onkeydown = e => { if (e.key === 'Enter') vai(); };
  }
  // bloqueia ao fim de 5 minutos fora da aplicação
  let escondidoEm = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) escondidoEm = Date.now();
    else if (emCamara) emCamara = false; // v164: voltar da câmara ou da galeria não bloqueia
    else if (CHAVE && escondidoEm && Date.now() - escondidoEm > 5 * 60 * 1000) { CHAVE = null; D = null; N = []; pedirPin(await ler('meta')); }
  });

  /* ---------------------------------------------------------------- estrutura */
  const ABAS = [['avisos', '🔔', 'Avisos'], ['propostas', '📄', 'Propostas'], ['clientes', '👥', 'Clientes'], ['catalogo', '📚', 'Catálogo'], ['ferramentas', '🧮', 'Ferramentas'], ['notas', '✏️', 'Anotações']];
  function principal() {
    raiz().innerHTML = '<header><h1 id="tit">GestVoltic</h1><button id="atu">⟳ Atualizar</button></header><main id="m"></main>' +
      '<nav class="abas">' + ABAS.map(([k, i, t]) => '<button data-aba="' + k + '"><b>' + i + '</b>' + t + '</button>').join('') + '</nav>' +
      '<input type="file" id="fich" accept=".json,application/json" hidden>';
    $('nav.abas').onclick = e => { const b = e.target.closest('[data-aba]'); if (b) { aba = b.dataset.aba; ecraExtra = null; desenhar(); window.scrollTo(0, 0); } };
    $('#atu').onclick = () => $('#fich').click();
    $('#fich').onchange = carregarFicheiro;
    desenhar();
    verPartilhas();
  }
  async function carregarFicheiro(ev) {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    try {
      const x = JSON.parse(await f.text());
      if (x.formato !== 'gestvoltic-movel-1') throw new Error('Este ficheiro não é o Voltic_movel.json do programa.');
      D = x; await guardarDados();
      alert('Atualizado com os dados do PC de ' + quando(x.geradoEm) + '.');
      desenhar();
    } catch (err) { alert('Não foi possível ler o ficheiro: ' + err.message); }
  }
  function desenhar() {
    document.querySelectorAll('nav.abas button').forEach(b => b.classList.toggle('on', b.dataset.aba === aba));
    const m = $('#m'); if (!m) return;
    $('#tit').textContent = (D?.empresa || 'GestVoltic');
    if (ecraExtra) return ecraExtra(m);
    if (!D && !['ferramentas', 'notas'].includes(aba)) {
      m.innerHTML = '<div class="cartao"><h2>Ainda sem dados</h2><p>Carregue em <b>⟳ Atualizar</b> e escolha o ficheiro <b>Voltic_movel.json</b> na pasta <b>GestVoltic_movel</b> do OneDrive.</p>' +
        '<p class="nota">O programa do PC atualiza esse ficheiro sozinho de 15 em 15 minutos. Se o OneDrive pedir, escolha «Manter sempre neste dispositivo».</p></div>';
      return;
    }
    ({ avisos: vAvisos, propostas: vPropostas, clientes: vClientes, catalogo: vCatalogo, ferramentas: vFerramentas, notas: vNotas })[aba](m);
  }
  const velho = () => D && D.geradoEm && (Date.now() - new Date(D.geradoEm).getTime() > 2 * 86400000);
  const topo = () => D ? '<p class="nota">Dados do PC de ' + h(quando(D.geradoEm)) + (velho() ? ' — <b style="color:#b3261e">têm mais de 2 dias: carregue em ⟳ Atualizar</b>' : '') + '</p>' : '';

  /* ---------------------------------------------------------------- avisos */
  function vAvisos(m) {
    const A = D.avisos || {};
    const grupos = {};
    for (const c of A.cartoes || []) (grupos[c.grupo] = grupos[c.grupo] || []).push(c);
    const alerta = t => /atraso|7 dias|faturas|propostas antigas/i.test(t);
    const tarefas = A.tarefas || [];
    const porArea = {};
    for (const t of tarefas) (porArea[t.area] = porArea[t.area] || []).push(t);
    m.innerHTML = topo() + Object.entries(grupos).map(([g, cs]) => '<div class="cartao"><h3>' + h(g) + '</h3><div class="grelha">' +
      cs.map(c => '<div class="num' + (alerta(c.titulo) && +c.n > 0 ? ' alerta' : '') + '"><span>' + h(c.titulo) + '</span><b>' + h(c.n) + '</b></div>').join('') + '</div></div>').join('') +
      '<div class="cartao"><h3>O que falta tratar (' + tarefas.length + ')</h3>' +
      (tarefas.length ? Object.entries(porArea).map(([a, ts]) => '<details' + (/Pagamentos|Cobranças/.test(a) ? ' open' : '') + '><summary><b>' + h(a) + '</b> (' + ts.length + ')</summary><ul class="lista">' +
        ts.map(t => '<li class="' + (t.ref && obraPorRef(t.ref) ? 'toque' : '') + '" data-ref="' + h(t.ref) + '"><div class="t">' + h(t.ref) + ' · ' + h(t.entidade) + '</div><div>' + h(t.tarefa) + '</div><div class="s">Prazo ' + h(dpt(t.prazo)) + (t.cliente && t.cliente !== '—' ? ' · ' + h(t.cliente) : '') + '</div></li>').join('') +
        '</ul></details>').join('') : '<p>Nada por tratar.</p>') + '</div>' +
      (A.em ? '<p class="nota">Avisos tal como a Principal do PC os mostrava em ' + h(quando(A.em)) + '.</p>' : '<p class="nota">Abra a Principal no PC para os avisos virem no próximo ficheiro.</p>');
    m.onclick = e => { const li = e.target.closest('li[data-ref]'); if (li && obraPorRef(li.dataset.ref)) abrirObra(obraPorRef(li.dataset.ref)); };
  }

  /* ---------------------------------------------------------------- propostas */
  const cliente = id => (D?.clientes || []).find(c => String(c.id) === String(id)) || {};
  const obraPorRef = ref => (D?.obras || []).find(w => w.ref === ref);
  const FECHADO = ['Fechado', 'Fechada', 'Concluída', 'Concluído', 'Perdido'];
  const ativa = w => !['Não adjudicada', 'Cancelada', 'Anulada'].includes(w.state) && !(w.state === 'Adjudicada' && FECHADO.includes(w.stage));
  const estadoChip = w => {
    const s = w.state === 'Enviada / em análise' ? 'Enviada' : w.state;
    const cls = w.state === 'Adjudicada' ? 'ok' : w.state === 'Não adjudicada' ? 'mau' : /Enviada/.test(w.state) ? 'am' : '';
    return '<span class="chip ' + cls + '">' + h(s) + (w.state === 'Adjudicada' && w.stage ? ' · ' + h(w.stage) : '') + '</span>';
  };
  function vPropostas(m) {
    const FS = ['Ativas', 'Em preparação', 'Enviada / em análise', 'Adjudicada', 'Todas'];
    const q = sem(procura.p);
    let ws = (D.obras || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.id - a.id);
    if (filtroEstado === 'Ativas') ws = ws.filter(ativa); else if (filtroEstado !== 'Todas') ws = ws.filter(w => w.state === filtroEstado);
    if (q) ws = ws.filter(w => sem([w.ref, w.description, cliente(w.client).name, w.finalClient, w.site, w.finalClientPhone, w.notesV34].join(' ')).includes(q));
    m.innerHTML = topo() + '<input type="search" id="q" placeholder="Procurar referência, cliente, morada…" value="' + h(procura.p) + '">' +
      '<div class="filtros" style="margin-top:8px">' + FS.map(f => '<button data-f="' + h(f) + '" class="' + (f === filtroEstado ? 'on' : '') + '">' + h(f === 'Enviada / em análise' ? 'Enviadas' : f) + '</button>').join('') + '</div>' +
      '<p class="nota">' + ws.length + ' proposta(s)</p><ul class="lista">' + ws.slice(0, 200).map(w =>
        '<li class="toque" data-id="' + w.id + '"><div class="t">' + h(w.ref) + ' · ' + h(w.description || '') + '</div><div class="s">' + h(cliente(w.client).name || '') +
        (w.finalClient ? ' · ' + h(w.finalClient) : '') + '</div><div>' + estadoChip(w) + ' <span class="s">' + h(dpt(w.date)) + (w.proposed ? ' · ' + eur(w.proposed) : '') + '</span></div></li>').join('') + '</ul>' +
      (ws.length > 200 ? '<p class="nota">Mostra as 200 mais recentes: use a procura.</p>' : '');
    const q2 = $('#q'); q2.oninput = () => { procura.p = q2.value; clearTimeout(q2._t); q2._t = setTimeout(() => { const pos = q2.selectionStart; vPropostas(m); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); }, 250); };
    m.onclick = e => {
      const f = e.target.closest('[data-f]'); if (f) { filtroEstado = f.dataset.f; return vPropostas(m); }
      const li = e.target.closest('li[data-id]'); if (li) abrirObra((D.obras || []).find(w => String(w.id) === li.dataset.id));
    };
  }
  const tel = t => t ? '<a href="tel:' + h(String(t).replace(/\s/g, '')) + '">' + h(t) + '</a>' : '';
  const mail = t => t ? '<a href="mailto:' + h(t) + '">' + h(t) + '</a>' : '';
  const mapa = t => t ? '<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(t) + '" target="_blank" rel="noopener">' + h(t) + '</a>' : '';
  function abrirObra(w) {
    if (!w) return;
    const ant = aba;
    ecraExtra = m => {
      const c = cliente(w.client), docs = (D.documentos || {})[w.ref] || [];
      const morada = [w.finalClientAddress, w.finalClientPostal, w.finalClientTown].filter(Boolean).join(', ') || w.site || '';
      const minhas = N.filter(n => n.ref === w.ref);
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>' + h(w.ref) + '</h2><div>' + estadoChip(w) + '</div><dl class="det">' +
        '<dt>Descrição</dt><dd>' + h(w.description || '—') + '</dd>' +
        '<dt>Origem do pedido</dt><dd>' + h(c.name || '—') + (c.phone ? '<br>' + tel(c.phone) : '') + (c.email ? '<br>' + mail(c.email) : '') + '</dd>' +
        (w.finalClient || w.finalClientPhone ? '<dt>Cliente final</dt><dd>' + h(w.finalClient || '') + (w.finalClientPhone ? '<br>' + tel(w.finalClientPhone) : '') + (w.finalClientEmail ? '<br>' + mail(w.finalClientEmail) : '') + '</dd>' : '') +
        (morada ? '<dt>Morada / local</dt><dd>' + mapa(morada) + '</dd>' : '') +
        '<dt>Valores</dt><dd>Proposta ' + eur(w.proposed) + (w.agreed ? ' · Adjudicado ' + eur(w.agreed) : '') + '</dd>' +
        '<dt>Datas</dt><dd>Pedido ' + h(dpt(w.date) || '—') + (w.sent ? ' · Enviada ' + h(dpt(w.sent)) : '') + (w.due ? ' · Ponto da situação ' + h(dpt(w.due)) : '') + (w.installDate ? ' · Instalação ' + h(dpt(w.installDate)) : '') + '</dd>' +
        (w.waitReason ? '<dt>Em espera</dt><dd>' + h(w.waitReason) + '</dd>' : '') +
        (w.notesV34 ? '<dt>Anotações</dt><dd style="white-space:pre-wrap">' + h(w.notesV34) + '</dd>' : '') + '</dl>' +
        '<p class="linha"><button class="btn" data-anotar>✏️ Anotar nesta proposta</button><button class="btn" data-relatorio>📝 Relatório</button></p></div>' +
        (minhas.length ? '<div class="cartao"><h3>As minhas anotações desta proposta</h3><ul class="lista">' + minhas.map(n => '<li class="toque" data-nota="' + h(n.id) + '"><div class="t">' + (n.tipoNota === 'relatorio' ? '📝 ' + h(n.assunto) + ' · ' : '') + h(quando(n.criada)) + '</div><div class="s">' + h(String(n.texto || '').slice(0, 100)) + '</div></li>').join('') + '</ul></div>' : '') +
        '<div class="cartao"><h3>Documentos (' + docs.length + ')</h3>' +
        '<p><a class="btn sec peq" href="https://drive.google.com/drive/search?q=' + encodeURIComponent(w.ref) + '" target="_blank" rel="noopener">Abrir no Google Drive</a></p>' +
        (docs.length ? '<ul class="lista">' + docs.map(([n, t, dt]) => '<li><div>' + h(n) + '</div><div class="s">' + (t ? (t / 1048576 >= 1 ? (t / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(t / 1024)) + ' KB') : '') + (dt ? ' · ' + h(dpt(dt)) : '') + '</div></li>').join('') + '</ul>'
          : '<p class="nota">Sem documentos na pasta da proposta.</p>') + '<p class="nota">Os documentos estão na pasta Orcamentos do Google Drive; o botão procura a pasta ' + h(w.ref) + ' na aplicação do Google Drive.</p></div>';
      m.onclick = e => {
        if (e.target.closest('.voltar')) { ecraExtra = null; aba = ant; return desenhar(); }
        if (e.target.closest('[data-anotar]')) return editarNota(novaNota(w));
        if (e.target.closest('[data-relatorio]')) return editarRelatorio(novoRelatorio(w));
        const li = e.target.closest('[data-nota]'); if (li) return editarNota(N.find(n => n.id === li.dataset.nota));
      };
    };
    desenhar(); window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------- clientes */
  function vClientes(m) {
    const q = sem(procura.c);
    let cs = (D.clientes || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt'));
    if (q) cs = cs.filter(c => sem([c.name, c.nif, c.phone, c.email, c.address, c.town].join(' ')).includes(q));
    m.innerHTML = topo() + '<input type="search" id="q" placeholder="Procurar nome, NIF, telefone…" value="' + h(procura.c) + '"><p class="nota">' + cs.length + ' cliente(s)</p><ul class="lista">' +
      cs.slice(0, 200).map(c => '<li class="toque" data-id="' + c.id + '"><div class="t">' + h(c.name) + '</div><div class="s">' + h([c.phone, c.town].filter(Boolean).join(' · ')) + '</div></li>').join('') + '</ul>';
    const q2 = $('#q'); q2.oninput = () => { procura.c = q2.value; clearTimeout(q2._t); q2._t = setTimeout(() => { const pos = q2.selectionStart; vClientes(m); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); }, 250); };
    m.onclick = e => { const li = e.target.closest('li[data-id]'); if (li) abrirCliente(cliente(li.dataset.id)); };
  }
  function abrirCliente(c) {
    ecraExtra = m => {
      const ws = (D.obras || []).filter(w => String(w.client) === String(c.id)).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const morada = [c.address, c.postal, c.town].filter(Boolean).join(', ');
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>' + h(c.name) + '</h2><dl class="det">' +
        (c.nif ? '<dt>NIF</dt><dd>' + h(c.nif) + '</dd>' : '') + (c.phone ? '<dt>Telefone</dt><dd>' + tel(c.phone) + '</dd>' : '') + (c.email ? '<dt>Email</dt><dd>' + mail(c.email) + '</dd>' : '') +
        (morada ? '<dt>Morada</dt><dd>' + mapa(morada) + '</dd>' : '') + '</dl></div><div class="cartao"><h3>Propostas (' + ws.length + ')</h3><ul class="lista">' +
        ws.map(w => '<li class="toque" data-id="' + w.id + '"><div class="t">' + h(w.ref) + ' · ' + h(w.description || '') + '</div><div>' + estadoChip(w) + ' <span class="s">' + h(dpt(w.date)) + '</span></div></li>').join('') + '</ul></div>';
      m.onclick = e => {
        if (e.target.closest('.voltar')) { ecraExtra = null; return desenhar(); }
        const li = e.target.closest('li[data-id]'); if (li) abrirObra((D.obras || []).find(w => String(w.id) === li.dataset.id));
      };
    };
    desenhar(); window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------- catálogo */
  function vCatalogo(m) {
    const cat = D.catalogo || [];
    m.innerHTML = topo() + (cat.length ? cat.map((g, i) => '<details class="cartao cat"' + (i === 0 ? ' open' : '') + '><summary><b>' + h(g.grupo) + '</b> (' + g.imagens.length + ')</summary><div style="margin-top:8px">' +
      g.imagens.map(src => '<img src="' + src + '" alt="' + h(g.grupo) + '" loading="lazy">').join('') + '</div></details>').join('') : '<p>O ficheiro do PC não trouxe catálogo.</p>');
    m.onclick = e => { const im = e.target.closest('.cat img'); if (im) { const w = window.open(); if (w) { w.document.write('<title>Catálogo</title><img src="' + im.src + '" style="width:100%">'); } } };
  }

  /* ---------------------------------------------------------------- ferramentas */
  function vFerramentas(m) {
    m.innerHTML = '<div class="filtros"><button data-t="calc" class="on">Cálculos elétricos</button><button data-t="ve">Carregamento VE</button></div><div id="ferr" class="cartao"></div>';
    const abre = t => {
      m.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t));
      const el = document.createElement('div'); const box = $('#ferr'); box.innerHTML = ''; box.append(el);
      if (t === 'calc' && window.VolticCalculos) window.VolticCalculos.ligar(el);
      else if (t === 've' && window.VolticCarregamento) window.VolticCarregamento.ligar(el);
      else el.textContent = 'Ferramenta indisponível.';
    };
    m.onclick = e => { const b = e.target.closest('[data-t]'); if (b) abre(b.dataset.t); };
    abre('calc');
  }

  /* ---------------------------------------------------------------- anotações */
  const novoId = () => Date.now().toString(36) + '-' + Array.from(crypto.getRandomValues(new Uint8Array(5)), b => b.toString(16).padStart(2, '0')).join('');
  function novaNota(w) {
    const agora = new Date().toISOString();
    const n = { id: novoId(), criada: agora, alterada: agora, ref: w ? w.ref : '', assunto: '', nome: '', telefone: '', email: '', morada: '', codigoPostal: '', localidade: '',
      potencia: '', instalacao: '', metros: '', texto: '', desenho: '', fotos: [], guardadaEm: '' };
    if (w) { n.nome = w.finalClient || cliente(w.client).name || ''; n.telefone = w.finalClientPhone || ''; n.morada = w.finalClientAddress || w.site || ''; }
    return n;
  }
  function vNotas(m) {
    const porGuardar = N.filter(n => !n.guardadaEm || n.alterada > n.guardadaEm);
    m.innerHTML = '<p class="linha">' + (FILA ? '<button class="btn" data-recebidas>📥 Fotografias recebidas (' + FILA + ')</button>' : '') + '<button class="btn" data-voz>🎤 Nota por voz</button><button class="btn" data-nova>+ Nova anotação</button><button class="btn sec" data-guardar' + (porGuardar.length ? '' : ' disabled') + '>⤴ Guardar anotações (' + porGuardar.length + ')</button></p>' +
      '<p class="nota">«Guardar anotações» cria um ficheiro: escolha <b>OneDrive</b> e a pasta <b>GestVoltic_movel › anotacoes</b>. O PC mostra-as em Configurações › Telemóvel e tablet.</p>' +
      blocoPC() + (N.length ? '<ul class="lista">' + N.slice().sort((a, b) => b.criada.localeCompare(a.criada)).map(n =>
        '<li class="toque" data-nota="' + h(n.id) + '"><div class="t">' + (n.ref ? h(n.ref) + ' · ' : '') + h(n.assunto || n.nome || 'Anotação') + '</div><div class="s">' + h(quando(n.criada)) +
        (n.telefone ? ' · ' + h(n.telefone) : '') + (n.desenho ? ' · ✏️' : '') + (n.fotos?.length ? ' · 📷' + n.fotos.length : '') + '</div><div>' +
        (!n.guardadaEm ? '<span class="chip am">por guardar</span>' : n.alterada > n.guardadaEm ? '<span class="chip am">alterada — por guardar</span>' : '<span class="chip ok">guardada ' + h(quando(n.guardadaEm)) + '</span>') + '</div></li>').join('') + '</ul>'
        : '<div class="cartao"><p>Ainda sem anotações. Use «+ Nova anotação» numa visita, ou abra uma proposta e carregue em «Anotar nesta proposta».</p></div>');
    m.onclick = e => {
      if (e.target.closest('[data-recebidas]')) return abrirRecebidas();
      if (e.target.closest('[data-voz]')) return editarRapida(novaRapida(), true);
      if (e.target.closest('[data-nova]')) return editarNota(novaNota(null));
      if (e.target.closest('[data-guardar]')) return exportar(porGuardar);
      const li = e.target.closest('[data-nota]'); if (li) editarNota(N.find(n => n.id === li.dataset.nota));
    };
  }
  /* v157: nota rápida e por voz */
  const Reconhecer = window.SpeechRecognition || window.webkitSpeechRecognition;
  function novaRapida() { return Object.assign(novaNota(null), { tipoNota: 'nota', voz: false, titulo: '', estado: 'pendente', responsavel: '', prazo: '', cliente: '', fornecedor: '' }); }
  function blocoPC() {
    const L = (D && D.notas) || [];
    return L.length ? '<div class="cartao"><h3>Assuntos a tratar no PC (' + L.length + ')</h3><ul class="lista">' + L.map(n => '<li><div class="t">' + h(n.titulo) + (n.voz ? ' 🎤' : '') + '</div>' + (n.descricao && n.descricao !== n.titulo ? '<div>' + h(String(n.descricao).slice(0, 160)) + '</div>' : '') + '<div class="s">' + h(n.estado === 'em análise' ? 'Em análise' : 'Pendente') + ' · ' + h(n.ligacao || 'Avulsa') + (n.responsavel ? ' · ' + h(n.responsavel) : '') + (n.prazo ? ' · Prazo ' + h(dpt(n.prazo)) : '') + '</div></li>').join('') + '</ul></div>' : '';
  }
  function editarRapida(n, ouvirLogo) {
    const ant = aba, antExtra = ecraExtra;
    let rec = null;
    const parar = () => { if (rec) { const r = rec; rec = null; try { r.stop(); } catch (_) { } } };
    const c = (k, rot, tipo = 'text', extra = '') => '<label class="campo"><span>' + rot + '</span><input data-k="' + k + '" type="' + tipo + '" value="' + h(n[k]) + '" ' + extra + '></label>';
    ecraExtra = m => {
      const obras = (D?.obras || []).map(w => '<option value="' + h(w.ref) + '">' + h(w.description || '') + '</option>').join('');
      const clis = (D?.clientes || []).map(x => '<option value="' + h(x.name) + '">').join('');
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>Nota rápida</h2>' + c('titulo', 'Título (opcional)') +
        '<label class="campo"><span>Texto</span><textarea data-k="texto" id="vt">' + h(n.texto) + '</textarea></label>' +
        '<p class="linha"><button class="btn sec" data-ouvir>🎤 Falar</button><span class="nota" id="vs"></span></p>' +
        '<label class="campo"><span>Estado</span><select data-k="estado">' + [['pendente', 'Pendente'], ['em análise', 'Em análise'], ['concluído', 'Concluído']].map(([v, t]) => '<option value="' + v + '"' + (v === n.estado ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
        c('responsavel', 'Responsável') + c('prazo', 'Prazo', 'date') +
        c('ref', 'Obra / proposta (vazio = avulsa)', 'text', 'list="vlo"') + c('cliente', 'Cliente', 'text', 'list="vlc"') + c('fornecedor', 'Fornecedor') +
        '<datalist id="vlo">' + obras + '</datalist><datalist id="vlc">' + clis + '</datalist>' +
        '<p class="linha" style="margin-top:14px"><button class="btn" data-gravar>Gravar no aparelho</button></p><p class="nota">Corrija o texto antes de gravar. Depois use «Guardar anotações» para a passar ao PC.</p></div>';
      const estado = t => { const e = $('#vs'); if (e) e.textContent = t; };
      const botao = () => m.querySelector('[data-ouvir]');
      const falar = () => {
        if (rec) return parar();
        if (!Reconhecer) return estado('Este aparelho não reconhece voz aqui. Use o microfone do teclado.');
        const r = new Reconhecer(); rec = r; r.lang = 'pt-PT'; r.continuous = true; r.interimResults = false;
        r.onresult = ev => {
          const a = $('#vt'); if (!a) return;
          for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) a.value = (a.value ? a.value.replace(/\s*$/, ' ') : '') + ev.results[i][0].transcript.trim();
          n.voz = true;
        };
        r.onerror = ev => estado(ev.error === 'not-allowed' ? 'O Chrome não tem autorização para usar o microfone.' : ev.error === 'network' ? 'O reconhecimento de voz precisa de internet.' : ev.error === 'no-speech' ? 'Não ouvi nada.' : 'Erro no reconhecimento: ' + ev.error);
        r.onend = () => { if (rec === r) rec = null; const b = botao(); if (b) b.textContent = '🎤 Falar'; };
        r.start(); const b = botao(); if (b) b.textContent = '⏹ Parar'; estado('A ouvir…');
      };
      m.onclick = async e => {
        if (e.target.closest('.voltar')) { parar(); ecraExtra = antExtra; aba = ant; return desenhar(); }
        if (e.target.closest('[data-ouvir]')) return falar();
        if (e.target.closest('[data-gravar]')) {
          parar();
          m.querySelectorAll('[data-k]').forEach(x => { n[x.dataset.k] = x.value.trim(); });
          if (!n.titulo && !n.texto) return estado('Escreva ou diga alguma coisa.');
          if (n.ref && D && !obraPorRef(n.ref)) return estado('Essa obra não existe na lista.');
          n.assunto = n.titulo || n.texto.split('\n')[0].slice(0, 60);
          n.alterada = new Date().toISOString();
          const i = N.findIndex(x => x.id === n.id); if (i >= 0) N[i] = n; else N.push(n);
          await guardarNotas();
          ecraExtra = antExtra; aba = antExtra ? ant : 'notas'; desenhar();
        }
      };
      if (ouvirLogo) { ouvirLogo = false; falar(); }
    };
    desenhar(); window.scrollTo(0, 0);
  }
  function editarNota(n) {
    if (n && n.tipoNota === 'nota') return editarRapida(n);
    if (n && n.tipoNota === 'relatorio') return editarRelatorio(n);
    const ant = aba, antExtra = ecraExtra;
    const c = (k, rot, tipo = 'text', extra = '') => '<label class="campo"><span>' + rot + '</span><input data-k="' + k + '" type="' + tipo + '" value="' + h(n[k]) + '" ' + extra + '></label>';
    ecraExtra = m => {
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>' + (n.ref ? 'Anotação — ' + h(n.ref) : 'Nova anotação (visita)') + '</h2>' +
        '<p class="nota">Pode escrever com a caneta em qualquer campo: o teclado do Android passa a escrita a texto.</p>' +
        (!n.ref ? c('assunto', 'Assunto (ex.: Posto de carregamento, quadro elétrico…)') : '') +
        c('nome', 'Nome') + c('telefone', 'Telefone', 'tel') + c('email', 'Email', 'email') + c('morada', 'Morada') +
        '<div class="linha"><div style="flex:1;min-width:120px">' + c('codigoPostal', 'Código postal') + '</div><div style="flex:2;min-width:160px">' + c('localidade', 'Localidade') + '</div></div>' +
        '<div class="linha"><div style="flex:1;min-width:120px">' + c('potencia', 'Potência a instalar (kW)', 'text', 'inputmode="decimal"') + '</div>' +
        '<div style="flex:1;min-width:120px"><label class="campo"><span>Tipo de instalação</span><select data-k="instalacao">' +
        ['', 'Esteira', 'Tubo', 'Calha', 'Enterrado', 'Outra'].map(o => '<option' + (o === n.instalacao ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></label></div>' +
        '<div style="flex:1;min-width:120px">' + c('metros', 'Metros de cabo', 'text', 'inputmode="decimal"') + '</div></div>' +
        '<label class="campo"><span>Notas</span><textarea data-k="texto">' + h(n.texto) + '</textarea></label>' +
        '<label class="campo"><span>Desenho à mão</span></label><canvas class="desenho" id="cv"></canvas><p class="linha"><button class="btn sec peq" data-limpar>Limpar desenho</button><span class="nota">Desenhe com a caneta ou o dedo.</span></p>' +
        '<label class="campo"><span>Fotografias</span></label><p class="linha"><button class="btn sec peq" data-foto="#ffc">📷 Tirar fotografia</button><button class="btn sec peq" data-foto="#ff">🖼 Escolher da galeria</button></p><input type="file" id="ffc" accept="image/*" capture="environment" hidden><input type="file" id="ff" accept="image/*" multiple hidden><div class="fotos" id="fts"></div>' +
        '<p class="linha" style="margin-top:14px"><button class="btn" data-gravar>Gravar no aparelho</button></p><p class="nota">Fica guardada (cifrada) neste aparelho. Depois use «Guardar anotações» para a passar ao PC.</p></div>';
      const desenhaFotos = () => { $('#fts').innerHTML = (n.fotos || []).map((f, i) => '<div><img src="' + f + '"><button data-tira="' + i + '">×</button></div>').join(''); };
      desenhaFotos();
      const cv = $('#cv'), ctx = cv.getContext('2d');
      const ajusta = () => { const r = cv.getBoundingClientRect(), k = window.devicePixelRatio || 1; cv.width = Math.round(r.width * k); cv.height = Math.round(r.height * k); ctx.setTransform(k, 0, 0, k, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height); if (n.desenho) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, r.width, r.height); im.src = n.desenho; } };
      ajusta();
      let traco = false, mexeu = false;
      const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      cv.onpointerdown = e => { traco = true; cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineWidth = e.pointerType === 'pen' ? Math.max(1.2, (e.pressure || .5) * 3.2) : 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; };
      cv.onpointermove = e => { if (!traco) return; const [x, y] = pos(e); if (e.pointerType === 'pen') ctx.lineWidth = Math.max(1.2, (e.pressure || .5) * 3.2); ctx.lineTo(x, y); ctx.stroke(); mexeu = true; };
      cv.onpointerup = cv.onpointercancel = () => { traco = false; };
      $('#ff').onchange = $('#ffc').onchange = async ev => {
        emCamara = false;
        for (const f of ev.target.files) { try { n.fotos.push(await reduzir(f)); } catch (_) { alert('Não consegui ler a fotografia ' + f.name); } }
        ev.target.value = ''; desenhaFotos();
      };
      m.onclick = async e => {
        if (e.target.closest('.voltar')) { if (mexeu && !confirm('Sair sem gravar o desenho?')) return; ecraExtra = antExtra; aba = ant; return desenhar(); }
        if (e.target.closest('[data-limpar]')) { n.desenho = ''; mexeu = true; return ajusta(); }
        const fb = e.target.closest('[data-foto]'); if (fb) { emCamara = true; return $(fb.dataset.foto).click(); }
        const t = e.target.closest('[data-tira]'); if (t) { n.fotos.splice(+t.dataset.tira, 1); return desenhaFotos(); }
        if (e.target.closest('[data-gravar]')) {
          m.querySelectorAll('[data-k]').forEach(x => { n[x.dataset.k] = x.value.trim(); });
          if (mexeu) n.desenho = vazio(cv) ? '' : cv.toDataURL('image/png');
          n.alterada = new Date().toISOString();
          const i = N.findIndex(x => x.id === n.id); if (i >= 0) N[i] = n; else N.push(n);
          await guardarNotas();
          ecraExtra = antExtra; aba = antExtra ? ant : 'notas'; desenhar();
        }
      };
    };
    desenhar(); window.scrollTo(0, 0);
  }
  function vazio(cv) {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 0; i < d.length; i += 16) if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) return false;
    return true;
  }
  function reduzir(file) {
    return new Promise((res, rej) => {
      const im = new Image(), url = URL.createObjectURL(file);
      im.onload = () => {
        const k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.8));
      };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('imagem')); };
      im.src = url;
    });
  }
  async function exportar(lista) {
    if (!lista.length) return;
    const agora = new Date(), nome = 'anotacoes_' + agora.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_') + '.json';
    const corpo = JSON.stringify({ formato: 'gestvoltic-anotacoes-1', versao: VERSAO, criadoEm: agora.toISOString(), anotacoes: lista.map(({ retiradas, ...x }) => x) });
    const file = new File([corpo], nome, { type: 'application/json' });
    let ok = false;
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: nome }); ok = true; }
    } catch (err) { if (err && err.name === 'AbortError') return; }
    if (!ok) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = nome; document.body.append(a); a.click(); a.remove();
      ok = confirm('O ficheiro ' + nome + ' foi descarregado. Passe-o para a pasta GestVoltic_movel › anotacoes do OneDrive.\n\nMarcar estas anotações como guardadas?');
    }
    if (!ok) return;
    const t = agora.toISOString();
    for (const n of lista) { const x = N.find(y => y.id === n.id); if (x) x.guardadaEm = t; }
    await guardarNotas(); desenhar();
  }

  /* ---------------------------------------------------------------- v164: relatório da obra e fotografias partilhadas */
  let TEC = '', FILA = 0, emCamara = false;
  const TIPOS = { inst: 'Relatório de Instalação', viab: 'Relatório de Viabilidade Técnica' };
  const lst = (...v) => v.map(x => [x, x]);
  const SN = [['', '—'], ...lst('Sim', 'Não')];
  const POT = [['', '—'], ...['2.2', '3.7', '7.4', '11', '22'].map(p => [p, p.replace('.', ',') + ' kW'])];
  const COMUNS = [['origin', 'Origem da instalação', [['', '—'], ['garagem', 'Quadro dos serviços comuns da garagem'], ['arrumos', 'Quadro dos arrumos da fração'], ['habitacao', 'Quadro da habitação']]], ['parking', 'Lugar de estacionamento'], ['applicant', 'Requerente']];
  const CAMPOS = {
    inst: [['regime', 'Regime', [['', '—'], ...lst('Monofásico', 'Trifásico')]], ['power', 'Potência', POT], ['breakerIn', '[In] disjuntor', [['', '—'], ...lst('16 A', '20 A', '25 A', '32 A', '40 A')]], ['rcdIn', '[In] diferencial', [['', '—'], ...lst('24 A', '40 A', '63 A')]],
      ['rcdClass', 'Classe de proteção', [['', '—'], ...lst('Tipo A', 'Tipo B')]], ['tube', 'Cabo em tubo VD HL com abraçadeiras', SN], ['tray', 'Cabo em caminho de esteira', SN], ['cableM', 'Comprimento do cabo (m)'],
      ['cableType', 'Tipo de cabo', [['', '—'], ...lst('3G4 RZ1K', '3G6 RZ1K', '3G10 RZ1K', '3G16 RZ1K', '5G4 RZ1K', '5G6 RZ1K', '5G10 RZ1K')]], ['test', 'Teste com o carregador do veículo', SN]],
    viab: [['equipModel', 'Modelo/Marca do equipamento', [['', '—'], ...lst('Carregador de parede em AC', 'Tomada')]], ['power', 'Potência nominal', POT]]
  };
  const hoje = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  function novoRelatorio(w) { return Object.assign(novaNota(w), { tipoNota: 'relatorio', tipoRelatorio: 'inst', assunto: TIPOS.inst, tecnico: TEC, data: hoje(), campos: {}, fotoObs: [], retiradas: [] }); }
  async function gravarRel(n) {
    n.alterada = new Date().toISOString();
    const i = N.findIndex(x => x.id === n.id); if (i >= 0) N[i] = n; else N.push(n);
    await guardarNotas();
  }
  async function juntarFotos(n, ficheiros) {
    let repetidas = 0; const falhas = [];
    for (const f of ficheiros) {
      try { const u = await reduzir(f); if (n.fotos.includes(u)) repetidas++; else { n.fotos.push(u); n.fotoObs.push(''); } } catch (_) { falhas.push(f.name || 'fotografia'); }
    }
    if (repetidas || falhas.length) alert([repetidas ? repetidas + ' fotografia(s) já estava(m) neste relatório e não foi/foram repetida(s).' : '', falhas.length ? 'Não consegui ler: ' + falhas.join(', ') : ''].filter(Boolean).join('\n'));
  }
  function editarRelatorio(n) {
    const ant = aba, antExtra = ecraExtra;
    if (!Array.isArray(n.retiradas)) n.retiradas = [];
    const campo = ([k, rot, ops]) => {
      const v = n.campos[k] ?? '';
      return '<label class="campo"><span>' + h(rot) + '</span>' + (ops ? '<select data-c="' + k + '">' + ops.map(([o, t]) => '<option value="' + h(o) + '"' + (o === v ? ' selected' : '') + '>' + h(t) + '</option>').join('') + '</select>'
        : '<input type="text" data-c="' + k + '" value="' + h(v) + '"' + (k === 'cableM' ? ' inputmode="decimal"' : '') + '>') + '</label>';
    };
    ecraExtra = m => {
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>Relatório — ' + h(n.ref) + '</h2>' +
        '<label class="campo"><span>Tipo de relatório</span><select data-k="tipoRelatorio">' + Object.entries(TIPOS).map(([k, t]) => '<option value="' + k + '"' + (k === n.tipoRelatorio ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
        '<label class="campo"><span>Técnico</span><input type="text" data-k="tecnico" value="' + h(n.tecnico) + '"></label><label class="campo"><span>Data</span><input type="date" data-k="data" value="' + h(n.data) + '"></label>' +
        [...COMUNS, ...CAMPOS[n.tipoRelatorio]].map(campo).join('') +
        '<label class="campo"><span>Observações</span><textarea data-k="texto">' + h(n.texto) + '</textarea></label>' +
        '<label class="campo"><span>Fotografias (' + n.fotos.length + ')</span></label><p class="linha"><button class="btn sec" data-abre="#rc">📷 Tirar fotografia</button><button class="btn sec" data-abre="#rg">🖼 Escolher da galeria</button></p>' +
        '<input type="file" id="rc" accept="image/*" capture="environment" hidden><input type="file" id="rg" accept="image/*" multiple hidden>' +
        n.fotos.map((f, i) => '<div class="linha" style="align-items:flex-start;margin-bottom:8px"><img src="' + f + '" alt="Fotografia ' + (i + 1) + '" style="width:96px;height:96px;object-fit:cover;border-radius:8px"><div style="flex:1;min-width:150px"><input type="text" data-fo="' + i + '" placeholder="Observação desta fotografia" value="' + h(n.fotoObs[i] || '') + '"><button class="btn sec peq" style="margin-top:6px" data-retira="' + i + '">Retirar</button></div></div>').join('') +
        (n.retiradas.length ? '<details><summary>Retiradas (' + n.retiradas.length + ')</summary>' + n.retiradas.map((f, i) => '<div class="linha" style="margin:6px 0"><img src="' + f.img + '" alt="Fotografia retirada" style="width:64px;height:64px;object-fit:cover;border-radius:8px"><button class="btn sec peq" data-repoe="' + i + '">Repor</button></div>').join('') + '</details>' : '') +
        '<p class="erro" id="re"></p><p class="linha" style="margin-top:14px"><button class="btn" data-gravar>Gravar no aparelho</button></p><p class="nota">Fica guardado (cifrado) neste aparelho. Depois use «Guardar anotações» para o passar ao PC; lá carrega em «Importar para o relatório».</p></div>';
      const ler = () => {
        m.querySelectorAll('[data-k]').forEach(x => { n[x.dataset.k] = x.value.trim(); });
        m.querySelectorAll('[data-c]').forEach(x => { n.campos[x.dataset.c] = x.value.trim(); });
        m.querySelectorAll('[data-fo]').forEach(x => { n.fotoObs[+x.dataset.fo] = x.value.trim(); });
        n.assunto = TIPOS[n.tipoRelatorio];
      };
      const sai = () => { ecraExtra = antExtra; aba = antExtra ? ant : 'notas'; desenhar(); };
      m.querySelector('[data-k="tipoRelatorio"]').onchange = () => { ler(); desenhar(); };
      for (const id of ['#rc', '#rg']) {
        const inp = $(id);
        inp.oncancel = () => { emCamara = false; };
        inp.onchange = async ev => { const fs = [...ev.target.files]; ev.target.value = ''; emCamara = false; ler(); await juntarFotos(n, fs); await gravarRel(n); desenhar(); };
      }
      m.onclick = async e => {
        if (e.target.closest('.voltar')) { ler(); if (n.fotos.length || n.texto || N.some(x => x.id === n.id)) await gravarRel(n); return sai(); }
        const ab = e.target.closest('[data-abre]'); if (ab) { emCamara = true; return $(ab.dataset.abre).click(); }
        const t = e.target.closest('[data-retira]');
        if (t) { ler(); const i = +t.dataset.retira; n.retiradas.push({ img: n.fotos[i], obs: n.fotoObs[i] || '', em: new Date().toISOString() }); n.fotos.splice(i, 1); n.fotoObs.splice(i, 1); await gravarRel(n); return desenhar(); }
        const r = e.target.closest('[data-repoe]');
        if (r) { ler(); const [x] = n.retiradas.splice(+r.dataset.repoe, 1); n.fotos.push(x.img); n.fotoObs.push(x.obs); await gravarRel(n); return desenhar(); }
        if (e.target.closest('[data-gravar]')) {
          ler();
          if (!n.tecnico) return $('#re').textContent = 'Indique o técnico.';
          if (!n.data) return $('#re').textContent = 'Indique a data.';
          if (n.tecnico !== TEC) { TEC = n.tecnico; await gravar('tecnico', await cifrar(TEC)); }
          await gravarRel(n); sai();
        }
      };
    };
    desenhar(); window.scrollTo(0, 0);
  }

  /* fotografias recebidas pelo «Partilhar» do Android: o sw.js deixa-as em espera neste aparelho até se escolher a obra */
  function abrirFila() {
    return new Promise((res, rej) => { const r = indexedDB.open('gestvoltic-partilha', 1); r.onupgradeneeded = () => r.result.createObjectStore('fila', { keyPath: 'id', autoIncrement: true }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  async function lerFila() { const db = await abrirFila(); return new Promise((res, rej) => { const t = db.transaction('fila').objectStore('fila').getAll(); t.onsuccess = () => res(t.result.filter(x => !x.ignorada)); t.onerror = () => rej(t.error); }); }
  async function mudarFila(itens, f) { const db = await abrirFila(); return new Promise((res, rej) => { const t = db.transaction('fila', 'readwrite'), s = t.objectStore('fila'); itens.forEach(x => f(s, x)); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
  async function verPartilhas() {
    try {
      const q = new URLSearchParams(location.search), lista = await lerFila();
      FILA = lista.length;
      if (q.has('partilha')) {
        history.replaceState(null, '', './');
        if (q.get('partilha') === 'erro') alert('Não foi possível receber as fotografias. Tente partilhar outra vez.');
        else if (FILA) return vPartilha(lista);
      }
      if (aba === 'notas' && !ecraExtra) desenhar();
    } catch (err) { console.error('partilha', err); }
  }
  async function abrirRecebidas() { const l = await lerFila(); FILA = l.length; if (l.length) vPartilha(l); else desenhar(); }
  function vPartilha(lista) {
    let txt = '';
    const urls = lista.map(x => URL.createObjectURL(x.blob));
    const fim = () => { urls.forEach(URL.revokeObjectURL); ecraExtra = null; aba = 'notas'; };
    ecraExtra = m => {
      const q = sem(txt);
      let ws = (D?.obras || []).slice().sort((a, b) => (ativa(b) - ativa(a)) || String(b.date || '').localeCompare(String(a.date || '')));
      if (q) ws = ws.filter(w => sem([w.ref, w.description, cliente(w.client).name, w.finalClient, w.site].join(' ')).includes(q));
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>Fotografias recebidas (' + lista.length + ')</h2><div class="fotos">' + urls.map(u => '<div><img src="' + u + '" alt="Fotografia recebida"></div>').join('') + '</div>' +
        '<p class="linha" style="margin-top:8px"><button class="btn sec peq" data-naousar>Não usar</button></p></div>' +
        (D ? '<input type="search" id="qo" placeholder="Escolher a obra: referência, cliente, morada…" value="' + h(txt) + '"><p class="nota">Toque na obra. As mais recentes em curso aparecem primeiro.</p><ul class="lista">' + ws.slice(0, 50).map(w => '<li class="toque" data-w="' + w.id + '"><div class="t">' + h(w.ref) + ' · ' + h(w.description || '') + '</div><div class="s">' + h(cliente(w.client).name || '') + (w.finalClient ? ' · ' + h(w.finalClient) : '') + '</div></li>').join('') + '</ul>'
          : '<div class="cartao"><p>Ainda sem obras neste aparelho. Carregue em <b>⟳ Atualizar</b> e volte aqui em Anotações › Fotografias recebidas.</p></div>');
      const o = $('#qo');
      if (o) o.oninput = () => { txt = o.value; clearTimeout(o._t); o._t = setTimeout(() => { const pos = o.selectionStart; ecraExtra(m); const b = $('#qo'); b.focus(); b.setSelectionRange(pos, pos); }, 250); };
      m.onclick = async e => {
        if (e.target.closest('.voltar')) { fim(); return desenhar(); }
        if (e.target.closest('[data-naousar]')) {
          if (!confirm('Não usar estas fotografias? As originais continuam na galeria.')) return;
          await mudarFila(lista, (s, x) => s.put(Object.assign(x, { ignorada: true }))); FILA = 0; fim(); return desenhar();
        }
        const li = e.target.closest('li[data-w]'); if (!li || m.dataset.ocupado) return;
        const w = D.obras.find(x => String(x.id) === li.dataset.w), aberto = N.find(x => x.tipoNota === 'relatorio' && x.ref === w.ref && (!x.guardadaEm || x.alterada > x.guardadaEm));
        const n = aberto && confirm('Juntar ao relatório por guardar de ' + quando(aberto.criada) + '?\n\nCancelar = criar um relatório novo.') ? aberto : novoRelatorio(w);
        m.dataset.ocupado = '1';
        try {
          await juntarFotos(n, lista.map(x => new File([x.blob], x.nome || 'fotografia.jpg', { type: x.tipo || 'image/jpeg' })));
          await gravarRel(n);
          await mudarFila(lista, (s, x) => s.delete(x.id)); // já estão cifradas no relatório
          FILA = 0; fim(); editarRelatorio(n);
        } catch (err) { alert('Não foi possível juntar as fotografias: ' + err.message); }
        finally { delete m.dataset.ocupado; }
      };
    };
    desenhar(); window.scrollTo(0, 0);
  }

  inicio();
})();

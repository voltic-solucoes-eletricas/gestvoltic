/* GestVoltic no telemóvel e no tablet (v147). Funciona sem o PC e sem rede.
   Dados: o Voltic_movel.json que o programa do PC grava na pasta do OneDrive; aqui escolhe-se esse ficheiro em «Atualizar».
   Tudo fica guardado SÓ neste aparelho, cifrado com o PIN (AES-GCM; chave PBKDF2 do PIN). Nada é enviado para lado nenhum:
   as anotações saem só quando o Jorge carrega em «Guardar anotações» e escolhe a pasta do OneDrive.
   v207: dados da nota nos campos, escrita à mão, análise (proposta, agenda, tarefa), impressão digital e aviso de versão nova.
   v208: atalhos no ícone (nota, voz, tarefas, agenda, ferramentas) e aba Agenda com as marcações do PC (só para ver).
   v209: retirar e repor notas (nunca se apaga), Potência no PTD (dados abertos E-REDES; GPS opcional) e simulador de garagem igual ao do PC.
   v237: vários filtros ao mesmo tempo nas Propostas; borracha e desfazer na escrita à mão; «Gravar» envia logo para o PC pelo Google Drive;
   separador Fornecedores; «A tratar» com o ecrã inicial do PC (tudo clicável, só para ler); a conta Google lembrada (sem escolher conta).
   v238: «A tratar» igual às bolas do «O que falta fazer» do PC; cada bola abre a lista do que há a fazer (só para ver).
   v239: separador ⏱ Tempos (entradas e saídas minhas e dos colaboradores, com a obra) que vão para o Registo de ponto do PC; reagendar
   todas as marcações; PIN/impressão digital só ao abrir a aplicação depois de fechada; botão 👁 para ocultar os valores; Catálogo nas Ferramentas.
   v240: agenda como no PC — Mês, Semana, Dia (e Lista), filtros por tipo e responsável; arrastar marcações para outro dia ou hora.
   v241: a vista Mês mostra só os dias do mês em questão.
   v242: fase (centro de custo) nos Tempos; obra de estrutura do ano (AACOM000) na lista de obras. */
(() => {
  'use strict';
  const VERSAO = '243';
  const $ = s => document.querySelector(s);
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let OCULTAR = (() => { try { return localStorage.getItem('gv_ocultar') === '1'; } catch (_) { return false; } })();   // v239: 👁
  const OLHO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="vertical-align:middle"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const OLHO_RISCADO = OLHO.replace('</svg>', '<line x1="3" y1="3" x2="21" y2="21"/></svg>');   // v240
  const oc = s => OCULTAR ? String(s ?? '').replace(/\d[\d .]*,\d{2}\s?€/g, '•••••• €') : s;
  const eur = v => OCULTAR ? '•••••• €' : (v == null || v === '' || isNaN(+v)) ? '—' : (+v).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
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
  let aba = 'avisos', ecraExtra = null, procura = { p: '', c: '', f: '' };
  let filtros = (() => { try { const x = JSON.parse(localStorage.getItem('gv_filtros') || 'null'); if (Array.isArray(x)) return x; } catch (_) { } return ['Ativas']; })();   // v237: vários filtros
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
      /* v239: sem deteção do ecrã */   // v235
    };
  }
  function pedirPin(meta) {
    raiz().innerHTML = '<div class="centro cartao"><h2>GestVoltic</h2><p>PIN</p><input id="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus>' +
      '<p class="erro" id="er"></p><button class="btn" id="ok">Entrar</button>' + (meta.bio ? '<p></p><button class="btn sec" id="bio">👆 Entrar com impressão digital</button>' : '') + '<p class="nota">Versão ' + h(VERSAO) + '</p></div>';
    const entra = async pin => { CHAVE = await derivar(pin, meta.sal); const t = await decifrar(meta.teste); if (t.ok !== 'gestvoltic') throw new Error(); };
    const abre = async () => {
      try { const x = await ler('dados'); D = x ? await decifrar(x) : null; } catch (_) { D = null; }
      try { const x = await ler('notas'); N = x ? await decifrar(x) : []; } catch (_) { N = []; }
      try { const x = await ler('tecnico'); TEC = x ? await decifrar(x) : ''; } catch (_) { TEC = ''; }
      principal();
      /* v239: sem deteção do ecrã */   // v235: a primeira vez pede a autorização (logo a seguir ao PIN, que conta como toque)
      sincronizar(true);   // v236
    };
    const vai = async () => {
      if (Date.now() < esperaAte) return $('#er').textContent = 'Espere ' + Math.ceil((esperaAte - Date.now()) / 1000) + ' s.';
      try { await entra($('#pin').value); } catch (_) {
        CHAVE = null; falhas++; if (falhas >= 5) { esperaAte = Date.now() + 30000; falhas = 0; }
        $('#pin').value = ''; return $('#er').textContent = 'PIN errado.';
      }
      await abre();
    };
    $('#ok').onclick = vai;
    $('#pin').onkeydown = e => { if (e.key === 'Enter') vai(); };
    if (meta.bio) $('#bio').onclick = async () => {   /* v207 */
      try { await entra(await bioPin(meta.bio)); } catch (err) { CHAVE = null; return $('#er').textContent = err && err.name === 'NotAllowedError' ? 'Cancelado. Pode usar o PIN.' : (err && err.message) || 'Não foi possível. Use o PIN.'; }
      await abre();
    };
  }
  // v235: o PIN volta a ser pedido só quando o ecrã bloqueia ou desliga (Deteção de inatividade do Chrome: estado do ecrã «locked»).
  //       Sem essa autorização, ou num aparelho que não a tenha, fica a regra antiga: 5 minutos fora da aplicação.
  let escondidoEm = 0, ecraBloqueou = false, detetor = null;
  const detetorPedido = () => { try { return localStorage.getItem('gv_detetor_pedido') === '1'; } catch (_) { return true; } };
  async function ligaDetetor(pedir) {
    if (detetor) return true;
    if (!('IdleDetector' in window)) return false;
    try {
      if (pedir) { try { localStorage.setItem('gv_detetor_pedido', '1'); } catch (_) { } if (await IdleDetector.requestPermission() !== 'granted') return false; }
      else { const st = await navigator.permissions.query({ name: 'idle-detection' }); if (st.state !== 'granted') return false; }
      const d = new IdleDetector();
      d.addEventListener('change', () => { if (d.screenState === 'locked') ecraBloqueou = true; });
      await d.start({ threshold: 60000 }); detetor = d; return true;
    } catch (_) { return false; }
  }
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { escondidoEm = Date.now(); if (detetor && detetor.screenState === 'locked') ecraBloqueou = true; return; }
    if (emCamara) { emCamara = false; return; }   // v164: voltar da câmara ou da galeria não bloqueia
    if (detetor) await new Promise(r => setTimeout(r, 400));   // deixa chegar o aviso de «ecrã bloqueado» que ficou em espera
    const bloquear = false;   // v239 (pedido do Jorge): o PIN/impressão digital só é pedido ao abrir a aplicação depois de fechada
    ecraBloqueou = false;
    if (bloquear) { CHAVE = null; D = null; N = []; pedirPin(await ler('meta')); }
    else if (CHAVE) verVersao();   // v207
  });

  /* ---------------------------------------------------------------- estrutura */
  const ABAS = [['avisos', '🔔', 'A tratar'], ['agenda', '📅', 'Agenda'], ['propostas', '📄', 'Propostas'], ['clientes', '👥', 'Clientes'], ['fornecedores', '🏭', 'Fornec.'], ['tempos', '⏱', 'Tempos'], ['ferramentas', '🧮', 'Ferram.'], ['notas', '✏️', 'Notas']];   // v237: nomes curtos para caberem 8
  function principal() {
    raiz().innerHTML = '<header><h1 id="tit">GestVoltic</h1><button id="olho" title="Mostrar ou ocultar os valores" aria-label="Mostrar ou ocultar os valores">👁</button><button id="atu">⟳ Atualizar</button></header><main id="m"></main>' +
      '<nav class="abas">' + ABAS.map(([k, i, t]) => '<button data-aba="' + k + '"><b>' + i + '</b>' + t + '</button>').join('') + '</nav>' +
      '<input type="file" id="fich" accept=".json,application/json" hidden>';
    $('nav.abas').onclick = e => { const b = e.target.closest('[data-aba]'); if (b) { aba = b.dataset.aba; ecraExtra = null; desenhar(); window.scrollTo(0, 0); } };
    $('#atu').onclick = () => gLigado() ? sincronizar(true, true) : $('#fich').click();   // v236
    $('#fich').onchange = carregarFicheiro;
    const ol = $('#olho'); ol.innerHTML = OCULTAR ? OLHO_RISCADO : OLHO;   // v239/v240
    ol.onclick = () => { OCULTAR = !OCULTAR; try { localStorage.setItem('gv_ocultar', OCULTAR ? '1' : '0'); } catch (_) { } ol.innerHTML = OCULTAR ? OLHO_RISCADO : OLHO; desenhar(); };
    desenhar();
    verPartilhas();
    verVersao();   // v207
    irPara();   // v208
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
    ({ avisos: vTratar, agenda: vAgenda, propostas: vPropostas, clientes: vClientes, fornecedores: vFornecedores, tempos: vTempos, catalogo: vCatalogo, ferramentas: vFerramentas, notas: vNotas })[aba](m);   // v237
  }
  const velho = () => D && D.geradoEm && (Date.now() - new Date(D.geradoEm).getTime() > 2 * 86400000);
  const COD237 = { avisos: 'M001 · A tratar', agenda: 'M002 · Agenda', propostas: 'M003 · Propostas', clientes: 'M004 · Clientes', fornecedores: 'M005 · Fornecedores', catalogo: 'M006 · Catálogo', ferramentas: 'M007 · Ferramentas', notas: 'M008 · Notas', tempos: 'M009 · Tempos' };   // v237: códigos dos ecrãs (índice H900 do PC)
  const topo = () => D ? '<p class="nota"><b>' + h(COD237[aba] || '') + '</b> · Dados do PC de ' + h(quando(D.geradoEm)) + (velho() ? ' — <b style="color:#b3261e">têm mais de 2 dias: carregue em ⟳ Atualizar</b>' : '') + '</p>' : '';

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
    const FS = ['Ativas', 'Em preparação', 'Enviada / em análise', 'Enviada – espera resposta', 'Adjudicada', 'Não adjudicada'];
    const NOME = { 'Enviada / em análise': 'Enviadas', 'Enviada – espera resposta': 'Espera resposta', 'Adjudicada': 'Adjudicadas', 'Não adjudicada': 'Não adjudicadas' };
    const passa = (f, w) => f === 'Ativas' ? ativa(w) : w.state === f;
    const q = sem(procura.p);
    let ws = (D.obras || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.id - a.id);
    const todasW = ws;
    if (filtros.length) ws = ws.filter(w => filtros.some(f => passa(f, w)));   // v237: basta cumprir um dos filtros escolhidos
    if (q) ws = ws.filter(w => sem([w.ref, w.description, cliente(w.client).name, w.finalClient, w.site, w.finalClientPhone, w.notesV34].join(' ')).includes(q));
    m.innerHTML = topo() + '<input type="search" id="q" placeholder="Procurar referência, cliente, morada…" value="' + h(procura.p) + '">' +
      '<div class="filtros" style="margin-top:8px"><button data-f="" class="' + (filtros.length ? '' : 'on') + '">Todas</button>' + FS.map(f => '<button data-f="' + h(f) + '" class="' + (filtros.includes(f) ? 'on' : '') + '">' + (filtros.includes(f) ? '✓ ' : '') + h(NOME[f] || f) + ' (' + todasW.filter(w => passa(f, w)).length + ')</button>').join('') + '</div>' +
      '<p class="nota" style="margin:0 0 4px">Pode escolher vários filtros; «Todas» limpa a escolha.</p>' +
      '<p class="nota">' + ws.length + ' proposta(s)</p><ul class="lista">' + ws.slice(0, 200).map(w =>
        '<li class="toque" data-id="' + w.id + '"><div class="t">' + h(w.ref) + ' · ' + h(w.description || '') + '</div><div class="s">' + h(cliente(w.client).name || '') +
        (w.finalClient ? ' · ' + h(w.finalClient) : '') + '</div><div>' + estadoChip(w) + ' <span class="s">' + h(dpt(w.date)) + (w.proposed ? ' · ' + eur(w.proposed) : '') + '</span></div></li>').join('') + '</ul>' +
      (ws.length > 200 ? '<p class="nota">Mostra as 200 mais recentes: use a procura.</p>' : '');
    const q2 = $('#q'); q2.oninput = () => { procura.p = q2.value; clearTimeout(q2._t); q2._t = setTimeout(() => { const pos = q2.selectionStart; vPropostas(m); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); }, 250); };
    m.onclick = e => {
      const f = e.target.closest('[data-f]'); if (f) { const v = f.dataset.f; filtros = !v ? [] : filtros.includes(v) ? filtros.filter(x => x !== v) : [...filtros, v]; try { localStorage.setItem('gv_filtros', JSON.stringify(filtros)); } catch (_) { } return vPropostas(m); }
      const li = e.target.closest('li[data-id]'); if (li) abrirObra((D.obras || []).find(w => String(w.id) === li.dataset.id));
    };
  }
  const tel = t => t ? '<a href="tel:' + h(String(t).replace(/\s/g, '')) + '">' + h(t) + '</a>' : '';
  const mail = t => t ? '<a href="mailto:' + h(t) + '">' + h(t) + '</a>' : '';
  const mapa = t => t ? '<a href="https://waze.com/ul?q=' + encodeURIComponent(t) + '&navigate=yes" target="_blank" rel="noopener" title="Abrir no Waze">' + h(t) + '</a>' : '';   // v235: moradas abrem no Waze
  function abrirObra(w) {
    if (!w) return;
    const ant = aba;
    ecraExtra = m => {
      const c = cliente(w.client), docs = (D.documentos || {})[w.ref] || [];
      const morada = [w.finalClientAddress, w.finalClientPostal, w.finalClientTown].filter(Boolean).join(', ') || w.site || '';
      const minhas = vivas().filter(n => n.ref === w.ref);
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>' + h(w.ref) + '</h2><div>' + estadoChip(w) + '</div><dl class="det">' +
        '<dt>Descrição</dt><dd>' + h(w.description || '—') + '</dd>' +
        '<dt>Origem do pedido</dt><dd>' + h(c.name || '—') + (c.phone ? '<br>' + tel(c.phone) : '') + (c.email ? '<br>' + mail(c.email) : '') + '</dd>' +
        (w.finalClient || w.finalClientPhone ? '<dt>Cliente final</dt><dd>' + h(w.finalClient || '') + (w.finalClientPhone ? '<br>' + tel(w.finalClientPhone) : '') + (w.finalClientEmail ? '<br>' + mail(w.finalClientEmail) : '') + '</dd>' : '') +
        (morada ? '<dt>Morada / local</dt><dd>' + mapa(morada) + '</dd>' : '') +
        (w.ptdV206 ? '<dt>Custo de ligação E-REDES (guardado no PC)</dt><dd>' + h(w.ptdV206.total) + ' sem IVA · ' + h(String(w.ptdV206.pedido && w.ptdV206.pedido.kva || '').replace('.', ',')) + ' kVA · ' + h(dpt(w.ptdV206.em)) + '</dd>' : '') + '<dt>Valores</dt><dd>Proposta ' + eur(w.proposed) + (w.agreed ? ' · Adjudicado ' + eur(w.agreed) : '') + '</dd>' +
        '<dt>Datas</dt><dd>Pedido ' + h(dpt(w.date) || '—') + (w.sent ? ' · Enviada ' + h(dpt(w.sent)) : '') + (w.due ? ' · Ponto da situação ' + h(dpt(w.due)) : '') + (w.installDate ? ' · Instalação ' + h(dpt(w.installDate)) : '') + '</dd>' +
        (w.waitReason ? '<dt>Em espera</dt><dd>' + h(w.waitReason) + '</dd>' : '') +
        (w.notesV34 ? '<dt>Anotações</dt><dd style="white-space:pre-wrap">' + h(w.notesV34) + '</dd>' : '') + '</dl>' +
        '<p class="linha"><button class="btn" data-anotar>✏️ Anotar nesta proposta</button><button class="btn" data-relatorio>📝 Relatório</button><button class="btn" data-ptd>⚡ Potência no PTD</button></p></div>' +
        (minhas.length ? '<div class="cartao"><h3>As minhas anotações desta proposta</h3><ul class="lista">' + minhas.map(n => '<li class="toque" data-nota="' + h(n.id) + '"><div class="t">' + (n.tipoNota === 'relatorio' ? '📝 ' + h(n.assunto) + ' · ' : '') + h(quando(n.criada)) + '</div><div class="s">' + h(String(n.texto || '').slice(0, 100)) + '</div></li>').join('') + '</ul></div>' : '') +
        '<div class="cartao"><h3>Documentos (' + docs.length + ')</h3>' +
        '<p><a class="btn sec peq" href="https://drive.google.com/drive/search?q=' + encodeURIComponent(w.ref) + '" target="_blank" rel="noopener">Abrir no Google Drive</a></p>' +
        (docs.length ? '<ul class="lista">' + docs.map(([n, t, dt]) => '<li><div>' + h(n) + '</div><div class="s">' + (t ? (t / 1048576 >= 1 ? (t / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(t / 1024)) + ' KB') : '') + (dt ? ' · ' + h(dpt(dt)) : '') + '</div></li>').join('') + '</ul>'
          : '<p class="nota">Sem documentos na pasta da proposta.</p>') + '<p class="nota">Os documentos estão na pasta Orcamentos do Google Drive; o botão procura a pasta ' + h(w.ref) + ' na aplicação do Google Drive.</p></div>';
      m.onclick = e => {
        if (e.target.closest('.voltar')) { ecraExtra = null; aba = ant; return desenhar(); }
        if (e.target.closest('[data-ptd]')) { PTDPRE = { ref: w.ref, morada, kva: (w.ptdV206 && w.ptdV206.kvaPedido) || '' }; ecraExtra = null; aba = 'ferramentas'; desenhar(); return window.scrollTo(0, 0); }   // v209
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
    m.innerHTML = '<div class="cartao" id="seg"></div><div class="filtros"><button data-t="calc" class="on">Cálculos elétricos</button><button data-t="ve">Carregamento VE</button><button data-t="ptd">Potência no PTD</button><button data-t="garagem">Garagem (escalões)</button><button data-t="catalogo">Catálogo</button></div><div id="ferr" class="cartao"></div>';
    const abre = t => {
      m.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t));
      const el = document.createElement('div'); const box = $('#ferr'); box.innerHTML = ''; box.append(el);
      if (t === 'calc' && window.VolticCalculos) window.VolticCalculos.ligar(el);
      else if (t === 've' && window.VolticCarregamento) window.VolticCarregamento.ligar(el);
      else if (t === 'ptd') ptdLigar(el);   // v209
      else if (t === 'garagem') garagemLigar(el);   // v209
      else if (t === 'catalogo') { if (D) vCatalogo(el); else el.textContent = 'Carregue em ⟳ Atualizar para ter o catálogo.'; }   // v239
      else el.textContent = 'Ferramenta indisponível.';
    };
    m.onclick = e => { const b = e.target.closest('[data-t]'); if (b) abre(b.dataset.t); };
    abre(PTDPRE ? 'ptd' : 'calc');   // v209: vindo de uma proposta abre a Potência no PTD
    cartaoSeg($('#seg'));   // v207
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
    const porGuardar = vivas().filter(n => !n.guardadaEm || n.alterada > n.guardadaEm);
    m.innerHTML = '<p class="linha">' + (FILA ? '<button class="btn" data-recebidas>📥 Fotografias recebidas (' + FILA + ')</button>' : '') + '<button class="btn" data-voz>🎤 Nota por voz</button><button class="btn" data-nova>+ Nova anotação</button>' + (gLigado() ? (porGuardar.length ? '<button class="btn sec" data-guardar>⤴ Enviar agora (' + porGuardar.length + ')</button>' : '') : '<button class="btn sec" data-guardar' + (porGuardar.length ? '' : ' disabled') + '>⤴ Guardar anotações (' + porGuardar.length + ')</button>') + '</p>' +
      (gLigado() ? '<p class="nota">☁ Ligado ao Google Drive: ao gravar, a anotação vai logo para o PC e fica lá guardada (<span id="gsinc">' + h(gEstado || '…') + '</span>).</p>' : '<p class="nota">«Guardar anotações» cria um ficheiro: escolha a pasta <b>GestVoltic_movel › anotacoes</b>. Para passar sozinho, ligue ao Google Drive em Ferramentas › Entrada e versão.</p>') +   // v236
      tarefasHtml() + blocoPC() + (vivas().filter(n => !['agenda', 'ponto'].includes(n.tipoNota)).length ? '<ul class="lista">' + vivas().filter(n => !['agenda', 'ponto'].includes(n.tipoNota)).sort((a, b) => b.criada.localeCompare(a.criada)).map(n =>
        '<li class="toque" data-nota="' + h(n.id) + '"><div class="t">' + (n.ref ? h(n.ref) + ' · ' : '') + h(n.assunto || n.nome || 'Anotação') + '</div><div class="s">' + h(quando(n.criada)) +
        (n.telefone ? ' · ' + h(n.telefone) : '') + (n.desenho ? ' · ✏️' : '') + (n.fotos?.length ? ' · 📷' + n.fotos.length : '') + '</div><div>' +
        (!n.guardadaEm ? '<span class="chip am">' + (gLigado() ? 'por enviar ao PC' : 'por guardar') + '</span>' : n.alterada > n.guardadaEm ? '<span class="chip am">alterada — ' + (gLigado() ? 'por enviar ao PC' : 'por guardar') + '</span>' : '<span class="chip ok">' + (gLigado() ? 'no PC desde ' : 'guardada ') + h(quando(n.guardadaEm)) + '</span>') + chipAnalise(n) + '</div></li>').join('') + '</ul>'
        : '<div class="cartao"><p>Ainda sem anotações. Use «+ Nova anotação» numa visita, ou abra uma proposta e carregue em «Anotar nesta proposta».</p></div>') + retiradasHtml();
    m.onclick = e => {
      const rp = e.target.closest('[data-repor]'); if (rp) return reporNota(rp.dataset.repor);   // v209
      const fe = e.target.closest('[data-feita]'); if (fe) return marcarFeita(fe.dataset.feita, fe.checked);   // v207
      if (e.target.closest('[data-recebidas]')) return abrirRecebidas();
      if (e.target.closest('[data-voz]')) return editarRapida(novaRapida(), true);
      if (e.target.closest('[data-nova]')) return editarNota(novaNota(null));
      if (e.target.closest('[data-guardar]')) return gLigado() ? sincronizar(true, true) : exportar(porGuardar);   // v236
      const li = e.target.closest('[data-nota]'); if (li) editarNota(N.find(n => n.id === li.dataset.nota));
    };
  }
  /* v157: nota rápida e por voz */
  const Reconhecer = window.SpeechRecognition || window.webkitSpeechRecognition;
  function novaRapida() { return Object.assign(novaNota(null), { tipoNota: 'nota', voz: false, titulo: '', estado: 'pendente', responsavel: '', prazo: '', cliente: '', fornecedor: '', analise: { tipo: '', prioridade: 'Normal', inicio: '', feita: false } }); }
  function blocoPC() {
    const L = ((D && D.notas) || []).filter(n => !n.tarefa && !N.some(y => y.id === n.origemId));   // v207: tarefas à parte; as minhas já estão na lista
    return L.length ? '<div class="cartao"><h3>Assuntos a tratar no PC (' + L.length + ')</h3><ul class="lista">' + L.map(n => '<li><div class="t">' + h(n.titulo) + (n.voz ? ' 🎤' : '') + '</div>' + (n.descricao && n.descricao !== n.titulo ? '<div>' + h(String(n.descricao).slice(0, 160)) + '</div>' : '') + '<div class="s">' + h(n.estado === 'em análise' ? 'Em análise' : 'Pendente') + ' · ' + h(n.ligacao || 'Avulsa') + (n.responsavel ? ' · ' + h(n.responsavel) : '') + (n.prazo ? ' · Prazo ' + h(dpt(n.prazo)) : '') + '</div></li>').join('') + '</ul></div>' : '';
  }
  /* ---------------------------------------------------------------- v209: retirar notas (nunca se apaga), Potência no PTD e simulador de garagem */
  const vivas = () => N.filter(n => !n.retiradaEm);
  async function retirarNota(n) {
    const x = N.find(y => y.id === n.id); if (!x) return false;
    if (!confirm('Retirar esta nota da lista?\n\n' + (x.guardadaEm ? 'Já foi para o PC e lá continua (no PC usa-se «Eliminar»).' : 'Ainda não foi para o PC: deixa de contar para «Guardar anotações».') + '\n\nFica em «Retiradas» e pode ser reposta.')) return false;
    x.retiradaEm = new Date().toISOString(); await guardarNotas(); return true;
  }
  async function reporNota(id) { const x = N.find(y => y.id === id); if (!x) return; delete x.retiradaEm; await guardarNotas(); desenhar(); }
  const botaoRetirar = n => N.some(y => y.id === n.id) ? '<button class="btn sec" data-retnota>🗑 Retirar nota</button>' : '';
  function retiradasHtml() {
    const R = N.filter(n => n.retiradaEm).sort((a, b) => String(b.retiradaEm).localeCompare(String(a.retiradaEm)));
    if (!R.length) return '';
    return '<details class="cartao"><summary><b>Retiradas (' + R.length + ')</b></summary><ul class="lista" style="margin-top:8px">' + R.map(n => '<li><div class="t">' + h(n.assunto || n.titulo || 'Anotação') + '</div><div class="s">Criada ' + h(quando(n.criada)) + ' · retirada ' + h(quando(n.retiradaEm)) + '</div><p class="linha" style="margin:6px 0 0"><button class="btn sec peq" data-repor="' + h(n.id) + '">Repor</button></p></li>').join('') + '</ul></details>';
  }

  /* código postal a partir da morada: sugestão do OpenStreetMap (só ao carregar), nunca por cima de um código já escrito */
  const CPBOT = '<p class="linha" style="margin-top:-4px"><button class="btn sec peq" data-cp>📮 Procurar código postal</button><span class="nota" data-cps></span></p>';
  async function cpBotao(m) {
    const g = k => m.querySelector('[data-k="' + k + '"]'), s = m.querySelector('[data-cps]'), diz = t => { if (s) s.textContent = t; };
    const mo = g('morada'), cp = g('codigoPostal'), lc = g('localidade');
    if (!mo || !cp) return;
    if (cp.value.trim()) return diz('Já tem código postal; não mudo.');
    const mor = mo.value.trim(), ja = mor.match(CP);
    const poeV = (x, v) => { if (x) { x.value = v; x.classList.add('novo'); } };
    if (ja) { if (!confirm('A morada já tem o código postal ' + ja[1] + '-' + ja[2] + '. Usar?')) return; poeV(cp, ja[1] + '-' + ja[2]); if (lc && !lc.value.trim() && ja[3].trim()) poeV(lc, ja[3].trim()); return diz('Preenchido a partir da morada; confirme e grave.'); }
    if (mor.length < 5) return diz('Escreva primeiro a morada (rua e número).');
    diz('A procurar…');
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'pt', addressdetails: '1', q: [mor, lc ? lc.value.trim() : ''].filter(Boolean).join(', ') }));
      const d = await r.json(), a = (d && d[0] && d[0].address) || {}, cpS = a.postcode || '', loc = a.city || a.town || a.village || a.municipality || '';
      if (!/^\d{4}-\d{3}$/.test(cpS)) return diz(cpS ? 'O mapa só sabe o início (' + cpS + '); confirme nos CTT.' : 'Não encontrei o código postal desta morada.');
      if (!confirm('Código postal sugerido pelo OpenStreetMap: ' + cpS + '\n' + [a.road, a.suburb || a.city_district, loc].filter((x, i, l) => x && l.indexOf(x) === i).join(', ') + '\n\nPode não ser exato para este número de porta. Usar?')) return diz('');
      poeV(cp, cpS); if (lc && !lc.value.trim() && loc) poeV(lc, loc);
      diz('Preenchido; confirme e grave.');
    } catch (_) { diz('Sem rede ou serviço indisponível.'); }
  }

  let PTDPRE = null;   // morada e proposta quando se abre a partir de uma proposta
  const PTDAPI = 'https://e-redes.opendatasoft.com/api/explore/v2.1/catalog/datasets/postos-transformacao-distribuicao/records?';
  const distM = (a, b, c, d) => { const r = 6371000, p1 = a * Math.PI / 180, p2 = c * Math.PI / 180, dp = p2 - p1, dl = (d - b) * Math.PI / 180; const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 2 * r * Math.asin(Math.sqrt(x)); };
  const reservaP = (kva, nivel) => { const t = String(nivel || ''); if (kva == null || kva === '' || t.includes('N/D')) return null; if (t.startsWith('+')) return 0; const n = (t.match(/\d+/g) || []).map(Number); return n.length ? Math.round(kva * (1 - Math.max(...n) / 100) * 10) / 10 : null; };
  const numP = v => { const t = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.'); return t === '' || isNaN(+t) ? null : +t; };
  const ntP = (v, d = 1) => v == null || v === '' || isNaN(+v) ? '—' : (+v).toLocaleString('pt-PT', { maximumFractionDigits: d });
  async function localizarP(m) {
    const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'pt', q: m }));
    if (!r.ok) throw new Error('OpenStreetMap respondeu ' + r.status);
    const d = await r.json(); return d && d[0] ? { lat: +d[0].lat, lon: +d[0].lon, encontrada: d[0].display_name } : null;
  }
  async function postosP(lat, lon) {
    if (!(lat >= 36 && lat <= 43 && lon >= -32 && lon <= -6)) throw new Error('as coordenadas não parecem ser de Portugal');
    const ponto = "geom'POINT(" + lon.toFixed(6) + ' ' + lat.toFixed(6) + ")'"; let res = [];
    for (const raio of [1000, 3000, 8000]) {
      const r = await fetch(PTDAPI + new URLSearchParams({ where: 'within_distance(coordenadas_geo, ' + ponto + ', ' + raio + 'm)', order_by: 'distance(coordenadas_geo, ' + ponto + ')', limit: '6' }));
      if (!r.ok) throw new Error('E-REDES respondeu ' + r.status);
      res = (await r.json()).results || []; if (res.length) break;
    }
    return res.map(r => { const g = r.coordenadas_geo || {}; return { codigo: r.cod_instalacao || '', distancia: Math.round(distM(lat, lon, g.lat ?? lat, g.lon ?? lon)), kva: r.potencia_transformacao_kva, nivel: r.nivel_utilizacao || '', reserva: reservaP(r.potencia_transformacao_kva, r.nivel_utilizacao), contratada: r.potencia_contratada || '', clientes: r.num_clientes ?? '', tipo: r.tipo_construtivo || '', concelho: r.con_name || '' }; });
  }
  function cabeP(p, kva, texto) {
    if (kva == null || kva <= 0) return '';
    if (p.reserva == null) return texto ? 'sem dados de utilização' : '<span class="chip">❔ sem dados</span>';
    const f = p.reserva - kva;
    if (f < 0) return texto ? 'não cabe (faltam ' + ntP(-f) + ' kVA)' : '<span class="chip mau">❌ não cabe · faltam ' + ntP(-f) + ' kVA</span>';
    if (f < 0.2 * kva) return texto ? 'à justa (sobram ' + ntP(f) + ' kVA)' : '<span class="chip am">⚠ à justa · sobram ' + ntP(f) + ' kVA</span>';
    return texto ? 'cabe (sobram ' + ntP(f) + ' kVA)' : '<span class="chip ok">✅ cabe · sobram ' + ntP(f) + ' kVA</span>';
  }
  function ptdLigar(el) {
    const pre = PTDPRE || {}; PTDPRE = null;
    const w = pre.ref ? obraPorRef(pre.ref) : null, g = w && w.ptdV206;
    let R = null, onde = null;
    el.innerHTML = '<h3>Potência no PTD' + (w ? ' — ' + h(w.ref) : '') + '</h3>' +
      '<label class="campo"><span>Morada</span><input type="text" id="pm" value="' + h(pre.morada || '') + '" placeholder="Rua, número de porta, localidade"></label>' +
      '<p class="linha"><button class="btn" id="pc">Consultar</button><button class="btn sec" id="pgps">📍 Onde estou</button></p>' +
      '<label class="campo"><span>Potência pretendida (kVA)</span><input type="text" inputmode="decimal" id="pk" value="' + h(pre.kva || '') + '" placeholder="ex.: 150"></label>' +
      (g ? '<div class="aviso">Custo E-REDES guardado no PC (' + h(dpt(g.em)) + '): <b>' + h(g.total) + '</b> sem IVA · ' + ntP(g.pedido && g.pedido.kva, 2) + ' kVA · posto ' + h(g.posto && g.posto.codigo) + ' · ' + h(g.pedido && g.pedido.distancia) + ' m · ' + h(g.pedido && g.pedido.quem) + '</div>' : '') +
      '<p class="nota" id="ps"></p><div id="pr"></div>' +
      '<p class="nota">Pela morada, só a morada vai para o OpenStreetMap; com «Onde estou», só as coordenadas vão para os dados abertos da E-REDES. O posto mais próximo pode não ser o que alimenta a morada e a reserva é uma estimativa (limite superior da faixa de utilização publicada). O custo de ligação calcula-se no PC (Potência no PTD › Custo) ou no simulador E-REDES; só o pedido de ligação confirma.</p>';
    const est = t => { el.querySelector('#ps').textContent = t; };
    const kvaAgora = () => numP(el.querySelector('#pk').value);
    const mostra = () => {
      const kva = kvaAgora();
      el.querySelector('#pr').innerHTML = R.length ? '<ul class="lista">' + R.map((p, i) => '<li><div class="t">' + h(p.codigo) + ' · ' + ntP(p.distancia, 0) + ' m</div><div class="s">' + h([p.concelho, p.tipo].filter(Boolean).join(' · ')) + '</div>' +
        '<div>Instalada <b>' + ntP(p.kva, 0) + ' kVA</b> · utilização ' + h(p.nivel || '—') + ' · reserva estimada <b>' + ntP(p.reserva) + ' kVA</b></div><div class="s">Contratada ' + h(p.contratada || '—') + ' kVA · ' + h(p.clientes) + ' clientes</div>' +
        '<div>' + cabeP(p, kva) + '</div><p class="linha" style="margin:6px 0 0"><button class="btn sec peq" data-psim="' + i + '">Simulador E-REDES</button><button class="btn sec peq" data-pgua="' + i + '">Guardar numa nota</button></p></li>').join('') + '</ul>'
        : '<p>Não há postos publicados num raio de 8 km.</p>';
    };
    const procura = async (lat, lon, texto) => {
      est('A procurar postos…');
      try { R = await postosP(lat, lon); onde = { lat, lon, texto }; est(texto); mostra(); } catch (err) { est('Não foi possível consultar a E-REDES (precisa de rede): ' + err.message); }
    };
    el.querySelector('#pc').onclick = async () => {
      const m = el.querySelector('#pm').value.trim();
      if (m.length < 5) return est('Escreva a morada com número de porta e localidade.');
      est('A localizar a morada…');
      try { const o = await localizarP(m); if (!o) return est('Não encontrei esta morada no mapa. Confirme a escrita ou, no local, use «Onde estou».'); await procura(o.lat, o.lon, 'Localizada em: ' + o.encontrada + '. Confirme que é o sítio certo.'); }
      catch (err) { est('Sem rede ou serviço indisponível: ' + err.message); }
    };
    el.querySelector('#pgps').onclick = () => {
      if (!navigator.geolocation) return est('Este aparelho não dá a localização.');
      est('A obter a localização…');
      navigator.geolocation.getCurrentPosition(p => procura(p.coords.latitude, p.coords.longitude, 'Localização atual (± ' + Math.round(p.coords.accuracy) + ' m).'),
        e => est(e.code === 1 ? 'Sem autorização para a localização (pode dar no Chrome › Definições do site).' : 'Não consegui obter a localização.'), { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
    };
    el.querySelector('#pk').oninput = () => { if (R) mostra(); };
    el.onclick = async e => {
      const s = e.target.closest('[data-psim]');
      if (s) {
        const p = R[+s.dataset.psim], kva = kvaAgora();
        const txt = 'Consumo › Baixa Tensão › Empresa ou negócio › Trifásico › ' + (kva == null ? '(potência)' : kva > 41.4 ? '«>» › ' + ntP(kva, 1) + ' kVA' : 'escalão logo acima de ' + ntP(kva, 2) + ' kVA') + ' › Subterrânea › ' + p.distancia + ' m (corrija para o comprimento real do ramal) › E-REDES';
        try { await navigator.clipboard.writeText(txt); } catch (_) { /* sem área de transferência */ }
        est('No simulador escreva: ' + txt + ' (texto copiado).');
        window.open('https://www.e-redes.pt/pt-pt/simulador', '_blank', 'noopener');
        return;
      }
      const gb = e.target.closest('[data-pgua]');
      if (gb) {
        const p = R[+gb.dataset.pgua], kva = kvaAgora(), n = novaRapida(), agora = new Date().toISOString();
        n.ref = w ? w.ref : ''; n.titulo = 'Potência no PTD — posto ' + p.codigo; n.assunto = n.titulo;
        n.texto = [onde ? onde.texto : '', 'Posto ' + p.codigo + ' a ' + p.distancia + ' m; instalada ' + ntP(p.kva, 0) + ' kVA; utilização ' + (p.nivel || '—') + '; reserva estimada ' + ntP(p.reserva) + ' kVA.',
          kva ? 'Potência pretendida ' + ntP(kva, 2) + ' kVA: ' + cabeP(p, kva, true) + '.' : '', 'Fonte: E-REDES, dados abertos (estimativa).'].filter(Boolean).join('\n');
        n.criada = agora; n.alterada = agora; N.push(n); await guardarNotas();
        est('Guardado numa nota' + (w ? ' da proposta ' + w.ref : '') + '. Use «Guardar anotações» para a passar ao PC.');
      }
    };
  }

  /* simulador de carregamento de garagem: os mesmos cálculos do PC (Voltic_simulador_escaloes.html, v205) */
  const TIERS = [10.35, 13.8, 17.25, 20.7, 27.6, 34.5, 41.4];
  function garagemLigar(el) {
    const opc = TIERS.map(v => '<option value="' + v + '">' + ntP(v, 2) + ' kVA — BTN</option>').join('') + '<option value="bte">BTE — introduzir potência até 100 kVA</option>';
    const c = (id, t, v, x) => '<label class="campo"><span>' + t + '</span><input id="g' + id + '" type="number" inputmode="decimal" value="' + v + '" ' + (x || '') + '></label>';
    el.innerHTML = '<h3>Simulador de carregamento de garagem</h3><label class="campo"><span>Potência contratada</span><select id="gtier">' + opc + '</select></label>' +
      '<label class="campo" id="gbtebox" hidden><span>Potência BTE (mais de 41,4 até 100 kVA)</span><input id="gbte" type="number" inputmode="decimal" value="60" min="41.5" max="100" step="0.1"></label>' +
      c('cars', 'Número de carros', 10, 'min="1" step="1"') + c('km', 'Quilómetros por carro por dia', 50, 'min="1"') + c('hours', 'Horas disponíveis por dia', 10, 'min="0.5" max="24" step="0.5"') + c('cons', 'Consumo (kWh/100 km)', 18, 'min="1" step="0.1"') + c('other', 'Outros consumos simultâneos (kW)', 0, 'min="0" step="0.1"') + c('pf', 'Fator de potência assumido', 0.95, 'min="0.1" max="1" step="0.01"') +
      '<div id="gres" class="cartao" style="background:#f4f8fb"></div><h3>Comparação de potências</h3><p class="nota">BTN: escalões oficiais de 10,35 a 41,4 kVA. Valores BTE são exemplos de simulação, não escalões oficiais.</p><ul class="lista" id="gcmp"></ul>' +
      '<p class="nota">Sem perdas. Assume aproveitamento contínuo da potência e gestão de carga adequada. Não verifica limites por fase, potência dos carregadores, capacidade das baterias ou viabilidade da ligação. Fator de potência assumido, não medido. Alternar noites não aumenta a energia média diária disponível. O mínimo calculado não substitui o dimensionamento elétrico. Fontes: Escalões BTN — E-REDES; DIT-C14-100: potências disponíveis e BTE.</p>';
    const $g = id => el.querySelector('#g' + id), fmt = n => n.toLocaleString('pt-PT', { maximumFractionDigits: 2 });
    function calc() {
      const isBte = $g('tier').value === 'bte'; $g('btebox').hidden = !isBte;
      const p = isBte ? +$g('bte').value : +$g('tier').value, ids = ['cars', 'km', 'hours', 'cons', 'other', 'pf'], [n, k, hh, c0, o0, pf] = ids.map(id => +$g(id).value);
      if (ids.some(id => $g(id).value === '') || n < 1 || !Number.isInteger(n) || k <= 0 || hh <= 0 || hh > 24 || c0 <= 0 || o0 < 0 || pf <= 0 || pf > 1 || (isBte && (p <= 41.4 || p > 100))) { $g('res').textContent = 'Verifique os valores introduzidos. BTE: potência superior a 41,4 e até 100 kVA.'; $g('cmp').innerHTML = ''; return; }
      const per = k * c0 / 100, e = Math.max(0, p * pf - o0) * hh, max = Math.floor((e + 1e-9) / per), req = n * per / hh, min = (req + o0) / pf, next = TIERS.find(v => v + 1e-9 >= min);
      const recomenda = min <= 41.4 ? 'Escalão BTN suficiente neste modelo: <b>' + fmt(next) + ' kVA</b>.' : 'Necessidade em BTE: <b>' + fmt(min) + ' kVA</b> no mínimo teórico' + (min > 100 ? ' — ultrapassa o limite de 100 kVA deste simulador' : '') + '.';
      $g('res').innerHTML = '<h3>' + (max >= n ? 'A potência chega para o objetivo.' : 'A potência não chega para todos.') + '</h3>Consegue servir <b>' + fmt(Math.min(n, max)) + ' dos ' + n + ' carros</b>.<br>Capacidade máxima: <b>' + max + ' carros/dia</b>.<br>O limite é ultrapassado a partir de <b>' + (max + 1) + ' carros</b>.<hr>Energia por carro: <b>' + fmt(per) + ' kWh/dia</b><br>Energia disponível: <b>' + fmt(e) + ' kWh/dia</b><br>Energia necessária para todos: <b>' + fmt(n * per) + ' kWh/dia</b><br>Potência necessária só para carregar: <b>' + fmt(req) + ' kW</b><br>Potência contratada mínima teórica: <b>' + fmt(min) + ' kVA</b><p>' + recomenda + '</p>Dividindo por todos: <b>' + fmt(e / n) + ' kWh ≈ ' + fmt(e / n / c0 * 100) + ' km por carro/dia</b>.';
      const vals = [...new Set([...TIERS, 50, 60, 70, 80, 90, 100, ...(isBte ? [p] : [])])].sort((a, b) => a - b);
      $g('cmp').innerHTML = vals.map(v => { const en = Math.max(0, v * pf - o0) * hh; return '<li style="' + (v === p ? 'background:#edf1ff;font-weight:700' : '') + '">' + fmt(v) + ' kVA · ' + (v <= 41.4 ? 'BTN' : 'BTE — exemplo') + '<div class="s">' + fmt(en) + ' kWh/dia · ' + Math.floor((en + 1e-9) / per) + ' carros</div></li>'; }).join('');
    }
    el.querySelectorAll('input,select').forEach(x => x.addEventListener('input', calc));
    calc();
  }

  /* ---------------------------------------------------------------- v208: agenda (só para ver) e atalhos do ícone */
  document.head.insertAdjacentHTML('beforeend', '<style>nav.abas button{font-size:10px;padding:8px 1px 9px}.ag-dia{margin:0 0 10px}.ag-dia h3{text-transform:capitalize}.ag-ev{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--linha)}.ag-ev:first-of-type{border-top:0}.ag-h{min-width:86px;font-weight:700;font-size:14px}.ag-c{width:10px;height:10px;border-radius:50%;margin-top:5px;flex:none}</style>');
  const CORAG = { 'Obra': '#1f7a4d', 'Visita técnica': '#2346d6', 'Reunião': '#7b3fb5', 'Prazo': '#b3261e', 'Outro': '#5f6b76', 'Pedido': '#b86e00' };
  let agPassados = false, agLista = [];   // v236: agLista
  const diaLocal = d => { const p = x => String(x).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  function vAgendaLista(m) {   // v240: a lista de antes (vista «Lista»)
    if (!Array.isArray(D.agenda)) {
      m.innerHTML = topo() + '<div class="cartao"><h2>Agenda</h2><p>O ficheiro do PC ainda não traz a agenda. Instale a versão 208 no PC e, depois de o programa gravar o ficheiro (até 15 minutos), carregue em <b>⟳ Atualizar</b>.</p></div>';
      return;
    }
    const hojeS = diaLocal(new Date()), d7 = new Date(); d7.setDate(d7.getDate() - 7);
    const desde = agPassados ? diaLocal(d7) : hojeS;
    /* pedido já tratado no PC: foi guardado, o ficheiro do PC é mais recente e a nota já não vem como «por tratar» */
    const tratado = n => n.guardadaEm && D.geradoEm && new Date(D.geradoEm) > new Date(n.guardadaEm) && !(D.notas || []).some(x => x.origemId === n.id);
    const pedidos = vivas().filter(n => n.analise && n.analise.tipo === 'agenda' && n.analise.inicio && !tratado(n))
      .map(n => ({ pedido: true, notaId: n.id, tipo: 'Pedido', titulo: n.assunto || 'Nota', inicio: n.analise.inicio, fim: '', local: [n.morada, n.localidade].filter(Boolean).join(', ') }));
    const L = [...agendaComPendentes(), ...pedidos].filter(e => String(e.fim || e.inicio).slice(0, 10) >= desde).sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
    const dias = {};
    for (const e of L) { const k = String(e.inicio).slice(0, 10) < desde ? desde : String(e.inicio).slice(0, 10); (dias[k] = dias[k] || []).push(e); }
    const hora = e => e.diaTodo ? 'Dia inteiro' : String(e.inicio).slice(11, 16) + (e.fim && String(e.fim).slice(0, 10) === String(e.inicio).slice(0, 10) ? '–' + String(e.fim).slice(11, 16) : '');
    const nomeDia = k => (k === hojeS ? 'Hoje · ' : '') + new Date(k + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: '2-digit' });
    agLista = L;   // v236
    m.innerHTML = topo() + '<p class="linha"><button class="btn" data-agn>+ Nova marcação</button></p><div class="filtros"><button data-ag="0" class="' + (agPassados ? '' : 'on') + '">Próximas</button><button data-ag="1" class="' + (agPassados ? 'on' : '') + '">Incluir os últimos 7 dias</button></div>' +
      (Object.keys(dias).length ? Object.entries(dias).map(([k, es]) => '<div class="cartao ag-dia"><h3>' + h(nomeDia(k)) + '</h3>' + es.map(e =>
        '<div class="ag-ev' + (e.ref && obraPorRef(e.ref) || e.pedido ? ' toque' : '') + '"' + (e.ref ? ' data-ref="' + h(e.ref) + '"' : '') + (e.pedido ? ' data-nota="' + h(e.notaId) + '"' : '') + '><span class="ag-c" style="background:' + (CORAG[e.tipo] || CORAG.Outro) + '"></span><div class="ag-h">' + h(hora(e)) + '</div><div style="flex:1;min-width:0">' +
        '<div><b>' + h(e.titulo) + '</b>' + (e.pedido ? ' <span class="chip am">pedido ao PC</span>' : '') + (e.pronta ? ' <span class="chip ok">✔ Pronta</span>' : '') + (e.pendente ? ' <span class="chip am">por passar ao PC</span>' : '') + '</div><div class="s">' + h([e.tipo !== 'Pedido' ? e.tipo : '', e.cliente, e.fornecedor, e.tecnico].filter(Boolean).join(' · ')) + '</div>' +
        (e.local ? '<div class="s">' + mapa(e.local) + '</div>' : '') + (e.notas ? '<div class="s" style="white-space:pre-wrap">' + h(String(e.notas).slice(0, 200)) + '</div>' : '') + botoesAg(e) + '</div></div>').join('') + '</div>').join('')
        : '<div class="cartao"><p>Sem marcações ' + (agPassados ? 'nos últimos 7 dias nem nos próximos meses' : 'nos próximos meses') + '.</p></div>') +
      '<p class="nota">Agenda do PC. As marcações novas, alteradas ou «prontas» feitas aqui passam sozinhas para o PC' + (gLigado() ? '.' : ' depois de ligar ao Google Drive (Ferramentas › Entrada e versão).') + '</p>';   // v236
    m.onclick = e => {
      if (e.target.closest('a')) return;
      if (e.target.closest('[data-agn]')) return formAgenda(null);   // v236
      const bp = e.target.closest('[data-agp]'); if (bp) { const x = agLista.find(y => String(y.id) === bp.dataset.agp); if (x && confirm('Marcar a visita «' + x.titulo + '» como pronta?')) acaoAgenda('pronta', { id: x.id, titulo: x.titulo }).then(() => vAgenda(m)); return; }
      const br = e.target.closest('[data-agr]'); if (br) { const x = agLista.find(y => String(y.id) === br.dataset.agr); if (x) formReagendar(x); return; }   // v239
      const be = e.target.closest('[data-age]'); if (be) { const x = agLista.find(y => String(y.id) === be.dataset.age); if (x) formAgenda(x); return; }
      const f = e.target.closest('[data-ag]'); if (f) { agPassados = f.dataset.ag === '1'; return vAgenda(m); }
      const n = e.target.closest('[data-nota]'); if (n) return editarNota(N.find(x => x.id === n.dataset.nota));
      const r = e.target.closest('[data-ref]'); if (r && obraPorRef(r.dataset.ref)) abrirObra(obraPorRef(r.dataset.ref));
    };
  }
  let IR = new URLSearchParams(location.search).get('ir') || '';
  function irPara() {
    const ir = IR; IR = '';
    if (!ir) return;
    if (/[?&]ir=/.test(location.search)) history.replaceState(null, '', './');
    if (ir === 'nota') return editarRapida(novaRapida());
    if (ir === 'voz') return editarRapida(novaRapida(), true);
    if (ir === 'agenda' || ir === 'ferramentas' || ir === 'tarefas') {
      aba = ir === 'tarefas' ? 'notas' : ir; ecraExtra = null; desenhar(); window.scrollTo(0, 0);
      if (ir === 'tarefas') { const t = $('#tarefas'); if (t) t.scrollIntoView({ block: 'start' }); }
    }
  }

  /* ---------------------------------------------------------------- v207: dados do texto, escrita à mão e análise da nota */
  document.head.insertAdjacentHTML('beforeend', '<style>input.novo{background:#fff4d6}input[type=datetime-local]{width:100%;padding:10px;border:1px solid #9fb3bf;border-radius:10px;background:#fff;font-size:16px}details>summary{cursor:pointer;padding:4px 0}#nv{position:sticky;top:0;z-index:6;margin:0;border-radius:0}</style>');
  const TEL = /(?<!\d)(?:\+?351[ .-]?)?(2\d{2}|9[1236]\d)[ .-]?(\d{3})[ .-]?(\d{3})(?!\d)/g, FISCAL = /(?:nif|nipc|contribuinte|contrib)[^a-z0-9]{0,4}$/i;
  const RUA = /(?:^|[\s,;/–-])((?:rua|av\.|avenida|travessa|tv\.|praceta|largo|alameda|estrada|calçada|urbanização|urb\.|praça|lugar)(?=[\s.,]|$)\s*\S[^\n]*)/i;
  const CP = /(?<![\d-])(\d{4})[-–\s](\d{3})(?![\d-])\s*([^\n,]*)/;
  const MAI = 'A-ZÁÂÃÀÉÊÍÓÔÕÚÇ', MIN = 'a-záâãàéêíóôõúç';
  const NOME = new RegExp('(?:^|[\\s,.;:(])(?:(?:[Nn]ome|[Cc]liente|[Cc]ontacto|[Ff]alar com|[Ss]ra|[Ss]r|[Ss]enhora|[Ss]enhor|[Dd]ona|[Ee]ngenheira|[Ee]ngenheiro|[Ee]ng|[Aa]rquiteta|[Aa]rquiteto|[Aa]rq)\\.?[\\s:]+)+(?!(?:Sra?|Senhora?|Dona|Eng|Arq)\\b)([' + MAI + '][' + MIN + ']+(?:\\s+(?:d[aeo]s?\\s+|e\\s+)?[' + MAI + '][' + MIN + ']+){0,4})');
  function dadosTexto(t) {
    t = String(t || '');
    const m = [...t.matchAll(TEL)].find(x => !FISCAL.test(t.slice(Math.max(0, x.index - 16), x.index)));
    const r = t.match(RUA), c = t.match(CP), nm = t.match(NOME);
    const limpa = s => String(s || '').replace(/[\w.+-]+@\S+/g, ' ').replace(TEL, ' ').replace(/[,;]?\s*(?:falar com|nome|contacto|cliente|sr\.|sra\.|senhora?|dona)(?=[\s:]).*$/i, '')
      .replace(/\b(?:tel|telef|telefone|telemóvel|telemovel|telm|tlm|email|e-mail|nif|nipc)\b.*$/i, '').replace(/[\s:;.,–-]+$/, '').trim();
    return { nome: nm ? nm[1] : '', telefone: m ? m[1] + ' ' + m[2] + ' ' + m[3] : '', email: (t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [''])[0].replace(/[.,;]+$/, ''),
      morada: r ? limpa(r[1].replace(CP, '')) : '', codigoPostal: c ? c[1] + '-' + c[2] : '', localidade: c ? limpa(c[3]) : '' };
  }
  const ROTC = { nome: 'nome', telefone: 'telefone', email: 'email', morada: 'morada', codigoPostal: 'código postal', localidade: 'localidade', cliente: 'cliente' };
  function retirar(n, m, auto) {
    const tx = m.querySelector('[data-k="texto"]'), ti = m.querySelector('[data-k="titulo"]');
    const t = [ti ? ti.value : '', tx ? tx.value : ''].filter(Boolean).join('\n');
    const d = dadosTexto(t), feitos = [];
    const cl = m.querySelector('[data-k="cliente"]');
    if (cl && !cl.value.trim() && D) {
      const st = sem(t), c = (D.clientes || []).filter(x => sem(x.name).length >= 5 && st.includes(sem(x.name))).sort((a, b) => b.name.length - a.name.length)[0];
      if (c) d.cliente = c.name;
    }
    for (const [k, v] of Object.entries(d)) { const el = m.querySelector('[data-k="' + k + '"]'); if (el && v && !el.value.trim()) { el.value = v; el.classList.add('novo'); feitos.push(ROTC[k]); } }
    if (feitos.length) { const det = m.querySelector('#ctd'); if (det) det.open = true; }
    return feitos.length ? 'Preenchi a partir do texto: ' + feitos.join(', ') + '.' : (auto ? '' : 'Não encontrei dados novos no texto (os campos já preenchidos não mudam).');
  }
  const cK = (n, k, rot, tipo = 'text', extra = '') => '<label class="campo"><span>' + rot + '</span><input data-k="' + k + '" type="' + tipo + '" value="' + h(n[k]) + '" ' + extra + '></label>';
  function contactoHtml(n) {
    const tem = ['nome', 'telefone', 'email', 'morada', 'codigoPostal', 'localidade'].some(k => n[k]);
    return '<details class="cartao" id="ctd"' + (tem ? ' open' : '') + '><summary><b>Contacto e morada</b></summary><p class="linha"><button class="btn sec peq" data-retirar>🔎 Retirar dados do texto</button></p>' +
      cK(n, 'nome', 'Nome do contacto') + cK(n, 'telefone', 'Telefone', 'tel') + cK(n, 'email', 'Email', 'text', 'inputmode="email"') + cK(n, 'morada', 'Morada') +
      '<div class="linha"><div style="flex:1;min-width:120px">' + cK(n, 'codigoPostal', 'Código postal') + '</div><div style="flex:2;min-width:160px">' + cK(n, 'localidade', 'Localidade') + '</div></div>' + CPBOT +
      '<p class="nota">Telefone: fixo 2xx ou móvel 91, 92, 93 ou 96. Números depois de NIF ou NIPC não contam.</p></details>';
  }
  const vazioC = cv => !cv.width || !cv.height || vazio(cv);
  function maoHtml(n) { return '<details id="mao"' + (n.desenho ? ' open' : '') + '><summary><b>✍ Escrever à mão</b></summary><p class="linha mao-barra" id="maob"></p><canvas class="desenho" id="cvr" style="height:260px"></canvas><p class="linha"><button class="btn sec peq" data-limparmao>Limpar tudo</button><span class="nota">Escreva com a caneta ou o dedo. A borracha apaga só onde passar.</span></p></details>'; }
  function maoLigar(m, n) {
    const cv = m.querySelector('#cvr'), ctx = cv.getContext('2d');
    let mexeu = false, traco = false, limpo = false;
    const ajusta = () => {
      const r = cv.getBoundingClientRect(); if (!r.width) return;
      const k = window.devicePixelRatio || 1; cv.width = Math.round(r.width * k); cv.height = Math.round(r.height * k);
      ctx.setTransform(k, 0, 0, k, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height);
      if (n.desenho && !limpo && !mexeu) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, r.width, r.height); im.src = n.desenho; }
    };
    m.querySelector('#mao').addEventListener('toggle', () => { if (!mexeu) ajusta(); });
    ajusta();
    tracos(cv, ctx, () => { mexeu = true; }, m.querySelector('#maob'));   // v237: caneta, borracha e desfazer
    m.querySelector('[data-limparmao]').onclick = () => { limpo = true; mexeu = true; ajusta(); };
    return { mexeu: () => mexeu, url: () => vazioC(cv) ? '' : cv.toDataURL('image/png'), tem: () => mexeu ? !vazioC(cv) : !!n.desenho };
  }
  const PRIO = ['Urgente', 'Elevada', 'Normal'];
  function analiseHtml(n) {
    const a = n.analise || {};
    const op = (v, t) => '<option value="' + v + '"' + (v === (a.tipo || '') ? ' selected' : '') + '>' + t + '</option>';
    return '<div class="cartao" style="background:#f4f8fb"><h3>Depois de analisar</h3><label class="campo"><span>O que fazer com esta nota</span><select data-a="tipo">' +
      op('', 'Ainda por decidir') + op('proposta', 'Criar proposta comercial (no PC)') + op('agenda', 'Marcar na agenda (no PC)') + op('tarefa', 'Tarefa a fazer') + '</select></label>' +
      '<div data-av="tarefa"><label class="campo"><span>Prioridade</span><select data-a="prioridade">' + PRIO.map(p => '<option' + (p === (a.prioridade || 'Normal') ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></label>' +
      '<label class="campo" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-a="feita"' + (a.feita ? ' checked' : '') + ' style="width:22px;height:22px"> Feita</label></div>' +
      '<div data-av="agenda"><label class="campo"><span>Data e hora</span><input type="datetime-local" data-a="inicio" value="' + h(a.inicio || '') + '"></label></div>' +
      '<p class="nota" data-av="proposta agenda">O PC mostra o pedido nesta nota; a proposta ou a marcação só ficam criadas quando as confirmar lá.</p></div>';
  }
  function ligarAnalise(m) {
    const s = m.querySelector('[data-a="tipo"]');
    const mostra = () => m.querySelectorAll('[data-av]').forEach(x => { x.hidden = !x.dataset.av.split(' ').includes(s.value); });
    s.onchange = mostra; mostra();
  }
  function lerAnalise(m, n) {
    const g = k => m.querySelector('[data-a="' + k + '"]'), tipo = g('tipo').value, ant = n.analise || {};
    const feita = tipo === 'tarefa' && g('feita').checked;
    return { tipo, prioridade: g('prioridade').value, inicio: tipo === 'agenda' ? g('inicio').value : '', feita, feitaEm: feita ? (ant.feita && ant.feitaEm ? ant.feitaEm : new Date().toISOString()) : '' };
  }
  const corP = p => p === 'Urgente' ? 'mau' : p === 'Elevada' ? 'am' : '';
  const chipAnalise = n => {
    const a = n.analise || {};
    if (a.tipo === 'tarefa') return ' <span class="chip ' + (a.feita ? 'ok' : corP(a.prioridade)) + '">' + (a.feita ? 'tarefa feita' : 'tarefa ' + h(a.prioridade)) + '</span>';
    if (a.tipo === 'proposta') return ' <span class="chip">pedido ao PC: proposta</span>';
    if (a.tipo === 'agenda') return ' <span class="chip">pedido ao PC: agenda ' + h(quando(a.inicio)) + '</span>';
    return '';
  };
  function tarefasHtml() {
    const ord = (a, b) => PRIO.indexOf(a.p) - PRIO.indexOf(b.p) || String(a.prazo || '9').localeCompare(String(b.prazo || '9'));
    const T = vivas().filter(n => n.analise && n.analise.tipo === 'tarefa' && !n.analise.feita).map(n => ({ n, p: n.analise.prioridade, prazo: n.prazo }));
    const P = ((D && D.notas) || []).filter(x => x.tarefa && !x.tarefa.feita && !N.some(y => y.id === x.origemId)).map(x => ({ x, p: x.tarefa.prioridade, prazo: x.prazo }));
    const L = [...T, ...P].sort(ord);
    if (!L.length) return '';
    return '<div class="cartao" id="tarefas"><h3>Tarefas (' + L.length + ')</h3><ul class="lista">' + L.map(o => o.n
      ? '<li><label style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" data-feita="' + h(o.n.id) + '" style="width:22px;height:22px;margin-top:2px;flex:none"><span><span class="chip ' + corP(o.p) + '">' + h(o.p) + '</span> <b>' + h(o.n.assunto || o.n.titulo || 'Nota') + '</b>' + (o.prazo ? '<br><span class="s">Prazo ' + h(dpt(o.prazo)) + '</span>' : '') + '</span></label></li>'
      : '<li><span class="chip ' + corP(o.p) + '">' + h(o.p) + '</span> <b>' + h(o.x.titulo) + '</b><div class="s">Do PC' + (o.prazo ? ' · Prazo ' + h(dpt(o.prazo)) : '') + ' · marca-se como feita no PC</div></li>').join('') + '</ul></div>';
  }
  async function marcarFeita(id, v) {
    const n = N.find(x => x.id === id); if (!n || !n.analise) return;
    n.analise.feita = v; n.analise.feitaEm = v ? new Date().toISOString() : ''; n.alterada = new Date().toISOString();
    await guardarNotas(); desenhar();
  }

  /* ---------------------------------------------------------------- v207: impressão digital (WebAuthn com PRF) e versão nova */
  /* O PIN fica cifrado com uma chave que só a impressão digital (ou o bloqueio de ecrã) deste aparelho liberta. O PIN continua sempre a funcionar. */
  const PRFSAL = enc.encode('GestVoltic-impressao-digital-v207');
  async function chaveBio(credId) {
    const r = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: credId }], userVerification: 'required', timeout: 60000, extensions: { prf: { eval: { first: PRFSAL } } } } });
    const out = r && r.getClientExtensionResults && r.getClientExtensionResults().prf && r.getClientExtensionResults().prf.results && r.getClientExtensionResults().prf.results.first;
    if (!out) throw new Error('Este aparelho não dá a chave da impressão digital a páginas (PRF). Continue com o PIN.');
    return crypto.subtle.importKey('raw', out, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async function bioPin(bio) {
    const k = await chaveBio(bio.id);
    try { return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bio.iv }, k, bio.c)); } catch (_) { throw new Error('A impressão digital não abriu o cofre. Entre com o PIN.'); }
  }
  async function ativarBio(pin) {
    if (!window.PublicKeyCredential || !navigator.credentials || !navigator.credentials.create) throw new Error('Este navegador não deixa usar a impressão digital em páginas.');
    if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable && !(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) throw new Error('Este aparelho não tem impressão digital nem bloqueio de ecrã configurado.');
    const cred = await navigator.credentials.create({ publicKey: { rp: { name: 'GestVoltic' }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'GestVoltic', displayName: 'GestVoltic' }, challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }, timeout: 60000, extensions: { prf: {} } } });
    const ex = cred.getClientExtensionResults ? cred.getClientExtensionResults().prf : null;
    if (ex && ex.enabled === false) throw new Error('Este aparelho não dá a chave da impressão digital a páginas (PRF). Continue com o PIN.');
    const id = new Uint8Array(cred.rawId), k = await chaveBio(id), iv = crypto.getRandomValues(new Uint8Array(12));
    const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(pin)));
    const meta = await ler('meta'); meta.bio = { id, iv, c, em: new Date().toISOString() }; await gravar('meta', meta);
  }
  let novaVersao = '';
  async function verVersao() {
    try {
      const t = await (await fetch('app.js?v=' + Date.now(), { cache: 'no-store' })).text();
      const v = (t.match(/const VERSAO = '([^']+)'/) || [])[1];
      if (v && v !== VERSAO) { novaVersao = v; faixa(); }
      if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => { });
    } catch (_) { /* sem rede: fica para a próxima */ }
  }
  function faixa() {
    if (!novaVersao || $('#nv')) return;
    document.body.insertAdjacentHTML('afterbegin', '<div id="nv" class="aviso">Há uma versão nova da aplicação (' + h(novaVersao) + '). <button class="btn peq" id="nvb">Atualizar agora</button></div>');
    $('#nvb').onclick = () => { if (ecraExtra && !confirm('Tem um ecrã aberto: grave primeiro o que estiver a escrever. Atualizar agora?')) return; location.reload(); };
  }
  function cartaoSeg(el) {
    if (!el) return;
    ler('meta').then(meta => {
      const tem = !!(meta && meta.bio);
      el.innerHTML = '<h3>Entrada e versão</h3><p>Versão da aplicação: <b>' + h(VERSAO) + '</b> ' + (novaVersao ? '— há a ' + h(novaVersao) + ' <button class="btn peq" data-recarregar>Atualizar</button>' : '<button class="btn sec peq" data-procurar>Procurar atualização</button>') + '</p>' +
        (tem ? '<p>👆 Entrada com impressão digital <b>ativa</b> desde ' + h(quando(meta.bio.em)) + '. <button class="btn sec peq" data-biodes>Desativar</button></p>'
          : '<p>Entrar com a impressão digital em vez de escrever o PIN (o PIN continua a funcionar).</p><input id="bpin" type="password" inputmode="numeric" placeholder="Escreva o PIN para ativar" autocomplete="current-password"><p class="linha" style="margin-top:8px"><button class="btn" data-bioat>Ativar impressão digital</button></p>') +
        '<p>🔒 O PIN (ou a impressão digital) é pedido ao abrir a aplicação depois de fechada — não quando fica em segundo plano. Enquanto está aberta, protege-a o bloqueio do próprio telemóvel.</p>' +   // v235
        '<p>☁ Google Drive: ' + (gLigado() ? '<b>ligado</b> — <span id="gsinc">' + h(gEstado || 'à espera da primeira sincronização') + '</span> <button class="btn sec peq" data-gsinc>Sincronizar agora</button> <button class="btn sec peq" data-gdes>Desligar</button>' : 'não ligado. <button class="btn peq" data-glig>Ligar ao Google Drive</button><br><small>Entra com a sua conta Google. O Google avisa «aplicação não verificada»: é normal (a aplicação é sua, em modo de teste) — carregue em «Continuar».</small>') + '</p>' +   // v236
        '<p class="erro" id="ber"></p>';
      el.onclick = async e => {
        const er = el.querySelector('#ber');
        if (e.target.closest('[data-glig]')) { try { await gToken(true); gPastas = null; await sincronizar(true, true); } catch (err) { er.textContent = 'Não foi possível ligar ao Google Drive: ' + err.message; } return cartaoSeg(el); }   // v236
        if (e.target.closest('[data-gsinc]')) { await sincronizar(true, true); return cartaoSeg(el); }
        if (e.target.closest('[data-gdes]')) { if (!confirm('Desligar do Google Drive? As anotações voltam a ser guardadas à mão.')) return; try { localStorage.removeItem('gv_google'); } catch (_) { } try { if (gTok && window.google) google.accounts.oauth2.revoke(gTok, () => { }); } catch (_) { } gTok = ''; gPastas = null; gEstado = ''; return cartaoSeg(el); }
        if (e.target.closest('[data-detetor]')) { const ok = await ligaDetetor(true); if (ok) return cartaoSeg(el); er.textContent = 'Sem autorização: o telemóvel recusou (pode autorizar em Definições do Chrome › Definições de sites › Deteção de inatividade). Continua a regra dos 5 minutos.'; return; }
        if (e.target.closest('[data-recarregar]')) return location.reload();
        if (e.target.closest('[data-procurar]')) { er.textContent = 'A procurar…'; await verVersao(); if (novaVersao) return cartaoSeg(el); er.textContent = 'Já tem a versão mais recente (ou está sem rede).'; return; }
        if (e.target.closest('[data-biodes]')) { if (!confirm('Desativar a entrada com impressão digital? Passa a entrar só com o PIN.')) return; const mt = await ler('meta'); delete mt.bio; await gravar('meta', mt); return cartaoSeg(el); }
        if (e.target.closest('[data-bioat]')) {
          const pin = el.querySelector('#bpin').value;
          try { const mt = await ler('meta'), k = await derivar(pin, mt.sal); await crypto.subtle.decrypt({ name: 'AES-GCM', iv: mt.teste.iv }, k, mt.teste.c); } catch (_) { er.textContent = 'PIN errado.'; return; }
          er.textContent = 'Toque no sensor quando o telemóvel pedir (pode pedir duas vezes)…';
          try { await ativarBio(pin); } catch (err) { er.textContent = err && err.name === 'NotAllowedError' ? 'Cancelado ou não autorizado. Pode tentar outra vez.' : (err && err.message) || 'Não foi possível ativar.'; return; }
          alert('Impressão digital ativada. Da próxima vez pode entrar com ela.'); cartaoSeg(el);
        }
      };
    });
  }

  function editarRapida(n, ouvirLogo) {
    const ant = aba, antExtra = ecraExtra;
    let rec = null;
    const parar = () => { if (rec) { const r = rec; rec = null; try { r.stop(); } catch (_) { } } };
    const c = (k, rot, tipo = 'text', extra = '') => '<label class="campo"><span>' + rot + '</span><input data-k="' + k + '" type="' + tipo + '" value="' + h(n[k]) + '" ' + extra + '></label>';
    ecraExtra = m => {
      const obras = (D?.obras || []).map(w => '<option value="' + h(w.ref) + '">' + h(w.description || '') + '</option>').join('');
      const clis = (D?.clientes || []).map(x => '<option value="' + h(x.name) + '">').join('');
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>Nota rápida <small class="nota">M101</small></h2>' + c('titulo', 'Título (opcional)') +
        '<label class="campo"><span>Texto</span><textarea data-k="texto" id="vt">' + h(n.texto) + '</textarea></label>' +
        '<p class="linha"><button class="btn sec" data-ouvir>🎤 Falar</button><span class="nota" id="vs"></span></p>' + maoHtml(n) + contactoHtml(n) +
        '<label class="campo"><span>Estado</span><select data-k="estado">' + [['pendente', 'Pendente'], ['em análise', 'Em análise'], ['concluído', 'Concluído']].map(([v, t]) => '<option value="' + v + '"' + (v === n.estado ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
        c('responsavel', 'Responsável') + c('prazo', 'Prazo', 'date') +
        c('ref', 'Obra / proposta (vazio = avulsa)', 'text', 'list="vlo"') + c('cliente', 'Cliente', 'text', 'list="vlc"') + c('fornecedor', 'Fornecedor') +
        '<datalist id="vlo">' + obras + '</datalist><datalist id="vlc">' + clis + '</datalist>' +
        analiseHtml(n) + '<p class="linha" style="margin-top:14px"><button class="btn" data-gravar>Gravar</button>' + botaoRetirar(n) + '</p><p class="nota">Corrija o texto antes de gravar. ' + notaGravar() + '</p></div>';
      const estado = t => { const e = $('#vs'); if (e) e.textContent = t; };
      const mao = maoLigar(m, n); ligarAnalise(m);   // v207
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
        if (e.target.closest('[data-cp]')) return cpBotao(m);   // v209
        if (e.target.closest('[data-retnota]')) { parar(); if (await retirarNota(n)) { ecraExtra = antExtra; aba = antExtra ? ant : 'notas'; desenhar(); } return; }   // v209
        if (e.target.closest('[data-retirar]')) return estado(retirar(n, m));   // v207
        if (e.target.closest('[data-ouvir]')) return falar();
        if (e.target.closest('[data-gravar]')) {
          parar();
          m.querySelectorAll('[data-k]').forEach(x => { n[x.dataset.k] = x.value.trim(); });
          if (!n.titulo && !n.texto && !mao.tem()) return estado('Escreva, diga ou desenhe alguma coisa.');
          if (!n.revistoV207) { const msg = retirar(n, m, true); if (msg) { n.revistoV207 = true; return estado(msg + ' Confirme e carregue outra vez em «Gravar».'); } }
          delete n.revistoV207;
          m.querySelectorAll('[data-k]').forEach(x => { n[x.dataset.k] = x.value.trim(); });
          n.analise = lerAnalise(m, n);
          if (n.analise.tipo === 'agenda' && !n.analise.inicio) return estado('Indique a data e a hora da marcação.');
          if (mao.mexeu()) n.desenho = mao.url();
          if (n.ref && D && !obraPorRef(n.ref)) return estado('Essa obra não existe na lista.');
          n.assunto = n.titulo || n.texto.split('\n')[0].slice(0, 60) || 'Nota à mão';
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
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>' + (n.ref ? 'Anotação — ' + h(n.ref) : 'Nova anotação (visita)') + ' <small class="nota">M100</small></h2>' +
        '<p class="nota">Pode escrever com a caneta em qualquer campo: o teclado do Android passa a escrita a texto.</p>' +
        (!n.ref ? c('assunto', 'Assunto (ex.: Posto de carregamento, quadro elétrico…)') : '') +
        c('nome', 'Nome') + c('telefone', 'Telefone', 'tel') + c('email', 'Email', 'email') + c('morada', 'Morada') +
        '<div class="linha"><div style="flex:1;min-width:120px">' + c('codigoPostal', 'Código postal') + '</div><div style="flex:2;min-width:160px">' + c('localidade', 'Localidade') + '</div></div>' + CPBOT +
        '<div class="linha"><div style="flex:1;min-width:120px">' + c('potencia', 'Potência a instalar (kW)', 'text', 'inputmode="decimal"') + '</div>' +
        '<div style="flex:1;min-width:120px"><label class="campo"><span>Tipo de instalação</span><select data-k="instalacao">' +
        ['', 'Esteira', 'Tubo', 'Calha', 'Enterrado', 'Outra'].map(o => '<option' + (o === n.instalacao ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></label></div>' +
        '<div style="flex:1;min-width:120px">' + c('metros', 'Metros de cabo', 'text', 'inputmode="decimal"') + '</div></div>' +
        '<label class="campo"><span>Notas</span><textarea data-k="texto">' + h(n.texto) + '</textarea></label>' +
        '<p class="linha"><button class="btn sec peq" data-retirar>🔎 Retirar dados do texto</button><span class="nota" id="vs2"></span></p>' +
        '<label class="campo"><span>Desenho à mão</span></label><p class="linha mao-barra" id="cvb"></p><canvas class="desenho" id="cv"></canvas><p class="linha"><button class="btn sec peq" data-limpar>Limpar tudo</button><span class="nota">Desenhe com a caneta ou o dedo. A borracha apaga só onde passar.</span></p>' +
        '<label class="campo"><span>Fotografias</span></label><p class="linha"><button class="btn sec peq" data-foto="#ffc">📷 Tirar fotografia</button><button class="btn sec peq" data-foto="#ff">🖼 Escolher da galeria</button></p><input type="file" id="ffc" accept="image/*" capture="environment" hidden><input type="file" id="ff" accept="image/*" multiple hidden><div class="fotos" id="fts"></div>' +
        '<p class="linha" style="margin-top:14px"><button class="btn" data-gravar>Gravar</button>' + botaoRetirar(n) + '</p><p class="nota">' + notaGravar() + '</p></div>';
      const desenhaFotos = () => { $('#fts').innerHTML = (n.fotos || []).map((f, i) => '<div><img src="' + f + '"><button data-tira="' + i + '">×</button></div>').join(''); };
      desenhaFotos();
      const cv = $('#cv'), ctx = cv.getContext('2d');
      const ajusta = () => { const r = cv.getBoundingClientRect(), k = window.devicePixelRatio || 1; cv.width = Math.round(r.width * k); cv.height = Math.round(r.height * k); ctx.setTransform(k, 0, 0, k, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height); if (n.desenho) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, r.width, r.height); im.src = n.desenho; } };
      ajusta();
      let mexeu = false;
      tracos(cv, ctx, () => { mexeu = true; }, $('#cvb'));   // v237: caneta, borracha e desfazer
      $('#ff').onchange = $('#ffc').onchange = async ev => {
        emCamara = false;
        for (const f of ev.target.files) { try { n.fotos.push(await reduzir(f)); } catch (_) { alert('Não consegui ler a fotografia ' + f.name); } }
        ev.target.value = ''; desenhaFotos();
      };
      m.onclick = async e => {
        if (e.target.closest('.voltar')) { if (mexeu && !confirm('Sair sem gravar o desenho?')) return; ecraExtra = antExtra; aba = ant; return desenhar(); }
        if (e.target.closest('[data-cp]')) return cpBotao(m);   // v209
        if (e.target.closest('[data-retnota]')) { if (await retirarNota(n)) { ecraExtra = antExtra; aba = antExtra ? ant : 'notas'; desenhar(); } return; }   // v209
        if (e.target.closest('[data-retirar]')) { const s = $('#vs2'); if (s) s.textContent = retirar(n, m) || 'Não encontrei dados novos no texto.'; return; }   // v207
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

  /* ---------------------------------------------------------------- v236: sincronização pelo Google Drive */
  // Entra uma vez com a conta Google (autorização «GestVoltic», em modo de teste); depois, sem escolher ficheiros: envia as anotações por guardar
  // para «O meu disco › GestVoltic_movel › anotacoes» e recebe o Voltic_movel.json do PC. A autorização dura 1 hora: renova-se no toque seguinte no ecrã.
  const GCLIENTE = '623272136348-plera80oo1n2lkpn1k1or8kn0g94r5eh.apps.googleusercontent.com', GESCOPO = 'https://www.googleapis.com/auth/drive';
  let gTok = '', gExp = 0, gCliente = null, gPastas = null, gEstado = '', gSinc = false;
  const gLigado = () => { try { return localStorage.getItem('gv_google') === '1'; } catch (_) { return false; } };
  const gValido = () => !!gTok && Date.now() < gExp - 60000;
  const hm = () => new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  function gScript() {
    return new Promise((ok, falha) => {
      if (window.google && google.accounts && google.accounts.oauth2) return ok();
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = () => ok(); s.onerror = () => falha(new Error('sem rede para o Google')); document.head.append(s);
    });
  }
  async function gToken(primeira) {
    if (gValido()) return gTok;
    await gScript();
    return new Promise((ok, falha) => {
      const conta = gConta();   // v237: a conta fica lembrada neste aparelho e vai como sugestão, para o Google não pedir para a escolher
      if (!gCliente || gCliente._conta !== conta) { gCliente = google.accounts.oauth2.initTokenClient(Object.assign({ client_id: GCLIENTE, scope: GESCOPO, callback: () => { } }, conta ? { hint: conta, login_hint: conta } : {})); gCliente._conta = conta; }
      gCliente.callback = r => { if (r.error) return falha(new Error(r.error)); gTok = r.access_token; gExp = Date.now() + (Number(r.expires_in) || 3600) * 1000; try { localStorage.setItem('gv_google', '1'); } catch (_) { } if (!conta) gLembrarConta(); ok(gTok); };
      gCliente.error_callback = e => falha(new Error(e && e.type === 'popup_closed' ? 'janela do Google fechada' : (e && e.type) || 'cancelado'));
      gCliente.requestAccessToken({ prompt: primeira ? 'consent' : '' });
    });
  }
  async function gApi(url, op) {
    if (!gValido()) throw new Error('autorização do Google expirada');
    const r = await fetch(url, Object.assign({}, op, { headers: Object.assign({}, (op && op.headers) || {}, { Authorization: 'Bearer ' + gTok }) }));
    if (r.status === 401) { gTok = ''; throw new Error('autorização do Google expirada'); }
    if (!r.ok) throw new Error('Google Drive respondeu ' + r.status);
    return r;
  }
  const gQ = async q => ((await (await gApi('https://www.googleapis.com/drive/v3/files?pageSize=20&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc&q=' + encodeURIComponent(q))).json()).files || []);
  async function gPastasDe() {
    if (gPastas) return gPastas;
    const raiz = (await gQ("name='GestVoltic_movel' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false"))[0];
    if (!raiz) throw new Error('a pasta GestVoltic_movel ainda não está no Google Drive (o PC cria-a depois de instalada a versão 236)');
    const anot = (await gQ("name='anotacoes' and mimeType='application/vnd.google-apps.folder' and '" + raiz.id + "' in parents and trashed=false"))[0];
    if (!anot) throw new Error('falta a pasta anotacoes dentro de GestVoltic_movel');
    return gPastas = { raiz: raiz.id, anot: anot.id };
  }
  async function gEnviar() {
    const lista = vivas().filter(n => !n.guardadaEm || n.alterada > n.guardadaEm); if (!lista.length) return 0;
    const P = await gPastasDe(), agora = new Date();
    const nome = 'anotacoes_' + agora.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_') + '_' + Math.random().toString(36).slice(2, 6) + '.json';
    const corpo = JSON.stringify({ formato: 'gestvoltic-anotacoes-1', versao: VERSAO, criadoEm: agora.toISOString(), anotacoes: lista.map(({ retiradas, ...x }) => x) });
    const b = 'gv' + Date.now(), meta = JSON.stringify({ name: nome, parents: [P.anot], mimeType: 'application/json' });
    await gApi('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b },
      body: '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + corpo + '\r\n--' + b + '--' });
    const t = agora.toISOString(); for (const n of lista) { const x = N.find(y => y.id === n.id); if (x) x.guardadaEm = t; }
    await _gGuardarNotas(); return lista.length;
  }
  async function gReceber() {
    const P = await gPastasDe(), f = (await gQ("name='Voltic_movel.json' and '" + P.raiz + "' in parents and trashed=false"))[0];
    if (!f) return false;
    let ult = ''; try { ult = localStorage.getItem('gv_g_mod') || ''; } catch (_) { }
    if (D && ult === f.modifiedTime) return false;
    const x = await (await gApi('https://www.googleapis.com/drive/v3/files/' + f.id + '?alt=media')).json();
    if (x.formato !== 'gestvoltic-movel-1') return false;
    D = x; await guardarDados(); try { localStorage.setItem('gv_g_mod', f.modifiedTime); } catch (_) { }
    return true;
  }
  async function sincronizar(interativo, avisar) {
    if (!gLigado() || gSinc || !CHAVE) return;
    gSinc = true;
    try {
      if (!gValido()) { if (!interativo) { gEstado = 'por sincronizar — carregue em ⟳ Atualizar'; return; } await gToken(false); }
      const env = await gEnviar(), rec = await gReceber();
      gEstado = 'sincronizado às ' + hm() + (env ? ' · ' + env + ' enviada(s)' : '') + (rec ? ' · dados do PC recebidos' : '');
      if (env || rec) desenhar();
      if (env && !avisar) aviso('✔ Enviada para o PC às ' + hm());   // v237
      if (avisar) alert('Sincronizado com o PC pelo Google Drive.' + (env ? '\n' + env + ' anotação(ões) enviada(s).' : '') + (rec ? '\nDados do PC atualizados.' : '\nOs dados do PC já estavam em dia.'));
    } catch (err) { gEstado = 'por sincronizar: ' + err.message; if (avisar) alert('Não foi possível sincronizar: ' + err.message); else if (porEnviar()) aviso('Gravada. Vai para o PC quando houver rede.'); }
    finally { gSinc = false; const t = document.getElementById('gsinc'); if (t) t.textContent = gEstado; }
  }
  const _gGuardarNotas = guardarNotas;
  /* v237: ao gravar envia logo (se o toque foi agora, pode renovar a autorização); já não abre o Google a cada toque no ecrã */
  guardarNotas = async function () { await _gGuardarNotas(); if (gLigado() && !gSinc) setTimeout(() => sincronizar(Date.now() - ultimoToque < 4000), 200); };
  setInterval(() => sincronizar(false), 2 * 60 * 1000);
  let ultimoToque = 0;
  document.addEventListener('click', () => { ultimoToque = Date.now(); }, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && gValido()) setTimeout(() => sincronizar(false), 800); });

  /* ---------------------------------------------------------------- v236: marcações na agenda feitas no telemóvel */
  const TIPOSAG = ['Visita técnica', 'Obra', 'Reunião', 'Prazo', 'Outro'];
  const agLocal = () => { const d = new Date(), p = x => String(x).padStart(2, '0'); return diaLocal(d) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  function agendaComPendentes() {
    const L = (D.agenda || []).map(e => Object.assign({}, e)), lim = new Date(Date.now() - 60 * 864e5).toISOString();
    for (const a of vivas().filter(n => n.tipoNota === 'agenda' && n.criada >= lim).sort((x, y) => x.criada.localeCompare(y.criada))) {
      const i = L.findIndex(e => String(e.id) === String(a.eventoId));
      if (a.acao === 'criar' && i < 0) L.push(Object.assign({}, a.evento, { pendente: true, editavel: true }));
      else if (a.acao === 'alterar' && i >= 0 && (!a.guardadaEm || !(D.geradoEm && new Date(D.geradoEm) > new Date(a.guardadaEm)))) L[i] = Object.assign({}, L[i], a.evento, { pendente: true });   // v243: até o PC a tratar
      else if (a.acao === 'apagar' && i >= 0) L.splice(i, 1);
      else if (a.acao === 'pronta' && i >= 0 && !L[i].pronta) L[i] = Object.assign({}, L[i], { pronta: true, pendente: true });
    }
    return L;
  }
  async function acaoAgenda(acao, ev, extra) {
    const agora = new Date().toISOString();
    N.push(Object.assign({ id: novoId(), criada: agora, alterada: agora, tipoNota: 'agenda', acao, eventoId: ev.id, evento: ev, assunto: 'Agenda: ' + (ev.titulo || ''), guardadaEm: '' }, extra || {}));
    await guardarNotas();
  }
  function botoesAg(e) {
    if (e.pedido) return '';
    const p = [], id = h(e.id);
    if (/visita/i.test(e.tipo || '') && !e.pronta && String(e.inicio) <= agLocal()) p.push('<button class="btn peq" data-agp="' + id + '">✔ Pronta</button>');
    if (e.editavel !== false && (!/^w:/.test(String(e.id)) || /^w:\d+:[vi]$/.test(String(e.id)))) p.push('<button class="btn sec peq" data-agr="' + id + '">📅 Reagendar</button>');   // v239
    if (e.editavel !== false && !/^w:/.test(String(e.id))) p.push('<button class="btn sec peq" data-age="' + id + '">✎ Alterar</button>');
    return p.length ? '<p class="linha" style="margin:6px 0 0">' + p.join('') + '</p>' : '';
  }
  function formAgenda(e) {
    const m = $('#m'), d = e || {}, dia = String(d.inicio || '').slice(0, 10) || diaLocal(new Date()), hi = d.diaTodo ? '' : String(d.inicio || '').slice(11, 16), hf = d.diaTodo ? '' : String(d.fim || '').slice(11, 16);
    const refs = (D.obras || []).map(w => w.ref).filter(Boolean);
    m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>' + (e ? 'Alterar marcação' : 'Nova marcação') + '</h2>' +
      '<label class="campo"><span>Tipo</span><select id="agt">' + TIPOSAG.map(t => '<option' + (t === (d.tipo || 'Visita técnica') ? ' selected' : '') + '>' + h(t) + '</option>').join('') + '</select></label>' +
      '<label class="campo"><span>Título</span><input id="agti" value="' + h(d.titulo || '') + '" placeholder="Ex.: Visita técnica — condomínio"></label>' +
      '<label class="campo"><span>Dia</span><input id="agd" type="date" value="' + h(dia) + '"></label>' +
      '<label class="campo"><span>Das</span><input id="aghi" type="time" value="' + h(hi) + '"></label><label class="campo"><span>Às</span><input id="aghf" type="time" value="' + h(hf) + '"></label>' +
      '<label class="campo"><span><input type="checkbox" id="agdt"' + (d.diaTodo ? ' checked' : '') + '> Dia inteiro</span></label>' +
      '<label class="campo"><span>Morada / local</span><input id="agl" value="' + h(d.local || '') + '"></label>' +
      '<label class="campo"><span>Proposta (referência)</span><input id="agr" list="agrl" value="' + h(d.ref || '') + '"><datalist id="agrl">' + refs.map(r => '<option value="' + h(r) + '">').join('') + '</datalist></label>' +
      '<label class="campo"><span>Técnico</span><input id="agtc" value="' + h(d.tecnico || TEC || '') + '"></label>' +
      '<label class="campo"><span>Notas</span><textarea id="agn2" rows="3">' + h(d.notas || '') + '</textarea></label>' +
      '<p class="erro" id="ager"></p><p class="linha"><button class="btn" data-ags>Guardar</button>' + (e ? '<button class="btn sec" data-agx>Apagar</button>' : '') + '</p>' +
      '<p class="nota">' + (gLigado() ? 'Passa sozinha para a agenda do PC.' : 'Para passar sozinha para o PC, ligue ao Google Drive em Ferramentas › Entrada e versão.') + '</p></div>';
    m.onclick = async ev => {
      if (ev.target.closest('.voltar')) return desenhar();
      if (ev.target.closest('[data-agx]')) { if (!confirm('Apagar esta marcação? No PC fica em «Apagados» e pode ser reposta.')) return; await acaoAgenda('apagar', { id: d.id, titulo: d.titulo }); aba = 'agenda'; return desenhar(); }
      if (!ev.target.closest('[data-ags]')) return;
      const ti = $('#agti').value.trim(), di = $('#agd').value, todo = $('#agdt').checked, a = $('#aghi').value, b = $('#aghf').value;
      if (!ti) return $('#ager').textContent = 'Escreva o título.';
      if (!di) return $('#ager').textContent = 'Escolha o dia.';
      if (!todo && !a) return $('#ager').textContent = 'Indique a hora de início (ou marque «Dia inteiro»).';
      const evn = { id: e ? e.id : 'a' + novoId(), tipo: $('#agt').value, titulo: ti, inicio: di + 'T' + (todo ? '00:00' : a), fim: di + 'T' + (todo ? '23:59' : (b || a)), diaTodo: todo, local: $('#agl').value.trim(), ref: $('#agr').value.trim(), tecnico: $('#agtc').value.trim(), notas: $('#agn2').value.trim() };
      await acaoAgenda(e ? 'alterar' : 'criar', evn); aba = 'agenda'; desenhar();
    };
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
        '<p class="erro" id="re"></p><p class="linha" style="margin-top:14px"><button class="btn" data-gravar>Gravar</button>' + botaoRetirar(n) + '</p><p class="nota">' + notaGravar() + ' No PC carrega em «Importar para o relatório».</p></div>';
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
        if (e.target.closest('[data-retnota]')) { if (await retirarNota(n)) sai(); return; }   // v209
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
        const w = D.obras.find(x => String(x.id) === li.dataset.w), aberto = vivas().find(x => x.tipoNota === 'relatorio' && x.ref === w.ref && (!x.guardadaEm || x.alterada > x.guardadaEm));
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

  /* ---------------------------------------------------------------- v237 */
  const estilo237 = document.createElement('style');
  estilo237.textContent = '.mao-barra{margin:0 0 6px}.mao-barra button{border:1px solid #9fb3bf;background:#fff;border-radius:20px;padding:5px 12px;font-size:13px}.mao-barra button.on{background:var(--azul2);border-color:var(--azul2);color:#fff}' +
    'nav.abas button{font-size:10px;min-width:0;overflow:hidden;text-overflow:ellipsis}nav.abas button b{font-size:19px}' +
    '.num.toque{cursor:pointer;border:1px solid transparent}.num.toque:active{border-color:var(--azul2)}.sec-t{display:flex;justify-content:space-between;align-items:center;gap:8px}' +
    '#gvaviso{position:fixed;left:50%;transform:translateX(-50%);bottom:76px;z-index:9;background:#17323f;color:#fff;padding:8px 14px;border-radius:20px;font-size:14px;box-shadow:0 4px 12px #0004;max-width:92vw}';
  document.head.append(estilo237);
  function aviso(t) { let a = document.getElementById('gvaviso'); if (!a) { a = document.createElement('div'); a.id = 'gvaviso'; document.body.append(a); } a.textContent = t; clearTimeout(a._t); a._t = setTimeout(() => a.remove(), 3500); }
  const porEnviar = () => vivas().some(n => !n.guardadaEm || n.alterada > n.guardadaEm);
  const notaGravar = () => gLigado() ? 'Ao gravar, vai logo para o PC pelo Google Drive e fica lá guardada (sem rede, vai assim que houver).' : 'Fica neste aparelho até usar «Guardar anotações» (ou ligue o Google Drive em Ferramentas para passar sozinho).';
  /* conta Google lembrada (só neste aparelho) */
  const gConta = () => { try { return localStorage.getItem('gv_g_conta') || ''; } catch (_) { return ''; } };
  async function gLembrarConta() {
    try { const r = await gApi('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)'); const j = await r.json(); const e = j && j.user && j.user.emailAddress; if (e) localStorage.setItem('gv_g_conta', e); } catch (_) { }
  }
  /* escrita à mão: caneta, borracha (apaga só onde passa) e desfazer */
  function tracos(cv, ctx, mexe, barra) {
    let modo = 'caneta', traco = false; const pilha = [];
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const larg = e => modo === 'borracha' ? 22 : e.pointerType === 'pen' ? Math.max(1.2, (e.pressure || .5) * 3.2) : 2.4;
    cv.onpointerdown = e => {
      try { pilha.push(ctx.getImageData(0, 0, cv.width, cv.height)); if (pilha.length > 30) pilha.shift(); } catch (_) { }
      traco = true; cv.setPointerCapture(e.pointerId); const [x, y] = pos(e);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineWidth = larg(e); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = modo === 'borracha' ? '#fff' : '#111';
      if (modo === 'borracha') { ctx.lineTo(x + .01, y); ctx.stroke(); mexe(); }
    };
    cv.onpointermove = e => { if (!traco) return; const [x, y] = pos(e); if (modo !== 'borracha' && e.pointerType === 'pen') ctx.lineWidth = larg(e); ctx.lineTo(x, y); ctx.stroke(); mexe(); };
    cv.onpointerup = cv.onpointercancel = () => { traco = false; };
    if (!barra) return;
    barra.innerHTML = '<button type="button" data-modo="caneta">✏️ Caneta</button><button type="button" data-modo="borracha">🧽 Borracha</button><button type="button" data-desfazer>↶ Desfazer</button>';
    const pinta = () => barra.querySelectorAll('[data-modo]').forEach(b => b.classList.toggle('on', b.dataset.modo === modo));
    barra.onclick = e => {
      const b = e.target.closest('[data-modo]');
      if (b) { e.stopPropagation(); modo = b.dataset.modo; return pinta(); }
      if (e.target.closest('[data-desfazer]')) { e.stopPropagation(); const im = pilha.pop(); if (im && im.width === cv.width && im.height === cv.height) { ctx.putImageData(im, 0, 0); mexe(); } }
    };
    pinta();
  }
  /* ---------- Fornecedores ---------- */
  function vFornecedores(m) {
    const L0 = D.fornecedores;
    if (!Array.isArray(L0)) { m.innerHTML = topo() + '<div class="cartao"><h2>Fornecedores</h2><p>O ficheiro do PC ainda não traz os fornecedores: instale no PC a versão 299 e carregue em ⟳ Atualizar.</p></div>'; return; }
    const q = sem(procura.f);
    let fs = L0.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt'));
    if (q) fs = fs.filter(f => sem([f.name, f.nif, f.phone, f.email, f.address, f.town, ...(f.pessoas || []).map(p => p.nome + ' ' + p.tel + ' ' + p.email)].join(' ')).includes(q));
    m.innerHTML = topo() + '<input type="search" id="q" placeholder="Procurar nome, NIF, telefone, pessoa…" value="' + h(procura.f) + '"><p class="nota">' + fs.length + ' fornecedor(es)</p><ul class="lista">' +
      fs.slice(0, 200).map(f => '<li class="toque" data-id="' + h(f.id) + '"><div class="t">' + h(f.name) + '</div><div class="s">' + h([f.phone, f.town, (f.pessoas || []).map(p => p.nome).filter(Boolean).join(', ')].filter(Boolean).join(' · ')) + '</div></li>').join('') + '</ul>' +
      (fs.length > 200 ? '<p class="nota">Mostra os primeiros 200: use a procura.</p>' : '');
    const q2 = $('#q'); q2.oninput = () => { procura.f = q2.value; clearTimeout(q2._t); q2._t = setTimeout(() => { const pos = q2.selectionStart; vFornecedores(m); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); }, 250); };
    m.onclick = e => { const li = e.target.closest('li[data-id]'); if (li) abrirFornecedor(L0.find(f => String(f.id) === li.dataset.id)); };
  }
  function abrirFornecedor(f) {
    if (!f) return;
    ecraExtra = m => {
      const morada = [f.address, f.postal, f.town].filter(Boolean).join(', ');
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>' + h(f.name) + '</h2><dl class="det">' +
        (f.nif ? '<dt>NIF</dt><dd>' + h(f.nif) + '</dd>' : '') + (f.phone ? '<dt>Telefone</dt><dd>' + tel(f.phone) + '</dd>' : '') + (f.email ? '<dt>Email</dt><dd>' + mail(f.email) + '</dd>' : '') +
        (morada ? '<dt>Morada</dt><dd>' + mapa(morada) + '</dd>' : '') + '</dl></div>' +
        ((f.pessoas || []).length ? '<div class="cartao"><h3>Pessoas (' + f.pessoas.length + ')</h3><ul class="lista">' + f.pessoas.map(p => '<li><div class="t">' + h(p.nome || '—') + '</div><div class="s">' + [p.tel ? tel(p.tel) : '', p.email ? mail(p.email) : ''].filter(Boolean).join(' · ') + '</div></li>').join('') + '</ul></div>' : '');
      m.onclick = e => { if (e.target.closest('.voltar')) { ecraExtra = null; return desenhar(); } };
    };
    desenhar(); window.scrollTo(0, 0);
  }
  /* ---------- A tratar: o ecrã inicial do PC, tudo clicável e só para ler ---------- */
  const REF237 = /^\d{2}[A-Z]{3}\d{3}$/;
  const dataDe = s => { s = String(s || ''); let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], m[2] - 1, +m[3]); m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(+m[3], m[2] - 1, +m[1]) : null; };
  const diasAte = d => { const h0 = new Date(); h0.setHours(0, 0, 0, 0); return Math.round((d - h0) / 864e5); };
  function linhaHtml(cab, r) {
    const ref = r.find(v => REF237.test(v) && obraPorRef(v)) || '';
    r = r.map(v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? dpt(v) : v);   // datas como no resto da app
    const tit = r.find(Boolean) || '—', resto = r.map((v, i) => v && v !== tit ? (cab[i] ? cab[i] + ': ' : '') + v : '').filter(Boolean);
    return '<li class="' + (ref ? 'toque' : '') + '" data-ref="' + h(ref) + '"><div class="t">' + h(oc(tit)) + '</div>' + (resto.length ? '<div class="s">' + h(oc(resto.join(' · '))) + '</div>' : '') + '</li>';
  }
  function itensDe(s, c) {
    if (c && c.estado) return { obras: (D.obras || []).filter(w => w.state === c.estado && (c.estado !== 'Adjudicada' || ativa(w))).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) };
    const tab = s => (s.tabelas || [])[0] || { cab: [], linhas: [] };
    if (c && c.area) { const F = (P().seccoes.find(x => /^O que falta tratar/.test(x.t)) || {}); const tb = tab(F); return { cab: tb.cab.slice(1), linhas: tb.linhas.filter(r => r[0] === c.area).map(r => r.slice(1)) }; }   // a área já é o título
    if (c && c.pagamentos) {
      const T = (P().seccoes.find(x => /^Previsão de tesouraria/.test(x.t)) || {}).tabelas || [];
      const tb = T.find(x => x.cab.some(k => /A quem/i.test(k))) || { cab: [], linhas: [] };
      const ok = d => /atraso/i.test(c.t) ? d != null && d < 0 : /7 dias/.test(c.t) ? d != null && d >= 0 && d <= 7 : /15 dias/.test(c.t) ? d != null && d > 7 && d <= 15 : /sem data/i.test(c.t) ? d == null : true;
      return { cab: tb.cab, linhas: tb.linhas.filter(r => { const x = dataDe(r[0]); return ok(x ? diasAte(x) : null); }), nota: 'Pagamentos da previsão de tesouraria do PC (lista completa no PC, em Pagamentos).' };
    }
    return { tabelas: s.tabelas || [], resumo: s.resumo || '' };
  }
  const P = () => (D && D.avisos && D.avisos.principalV299) || null;
  function vTratar(m) {
    if (D && D.avisos && D.avisos.faltaV300) return vFalta(m);   // v238: as bolas do PC (precisa da v300 no PC)
    const F = P();
    if (!F) return vAvisos(m);   // ficheiro de um PC sem a v299: fica o quadro antigo
    const nLinhas = s => (s.tabelas || []).reduce((a, t) => a + t.linhas.length, 0);
    m.innerHTML = topo() + F.seccoes.map((s, i) => '<div class="cartao"><div class="sec-t"><h3>' + h(s.t) + '</h3>' + (s.tabelas && s.tabelas.length || s.resumo ? '<button class="btn sec peq" data-s="' + i + '">Ver ›</button>' : '') + '</div>' +
      (s.cartoes.length ? '<div class="grelha">' + s.cartoes.map((c, j) => '<div class="num toque' + (/atraso/i.test(c.t) && parseFloat(c.n) > 0 ? ' alerta' : '') + '" data-s="' + i + '" data-c="' + j + '"><span>' + h(c.t) + '</span><b>' + h(c.n) + '</b></div>').join('') + '</div>'
        : nLinhas(s) ? '<div class="num toque" data-s="' + i + '"><span>Na lista</span><b>' + nLinhas(s) + '</b></div>' : s.resumo ? '<p class="s toque" data-s="' + i + '">' + h(s.resumo.slice(0, 160)) + '</p>' : '<p class="nota">Nada por tratar.</p>') + '</div>').join('') +
      '<p class="nota">Como no ecrã inicial do PC em ' + h(quando(F.em)) + '. Toque num quadrado para ver a lista (só para ler).</p>';
    m.onclick = e => { const x = e.target.closest('[data-s]'); if (!x) return; const s = F.seccoes[+x.dataset.s]; abrirTratar(s, x.dataset.c != null ? s.cartoes[+x.dataset.c] : null); };
  }
  function abrirTratar(s, c) {
    const ant = aba, antExtra = ecraExtra;
    ecraExtra = m => {
      const I = itensDe(s, c);
      let corpo = '';
      if (I.obras) corpo = I.obras.length ? '<ul class="lista">' + I.obras.map(w => '<li class="toque" data-id="' + w.id + '"><div class="t">' + h(w.ref) + ' · ' + h(w.description || '') + '</div><div class="s">' + h(cliente(w.client).name || '') + (w.finalClient ? ' · ' + h(w.finalClient) : '') + '</div><div>' + estadoChip(w) + ' <span class="s">' + h(dpt(w.date)) + (w.due ? ' · Ponto da situação ' + h(dpt(w.due)) : '') + '</span></div></li>').join('') + '</ul>' : '<p>Nada nesta lista.</p>';
      else if (I.linhas) corpo = (I.linhas.length ? '<ul class="lista">' + I.linhas.map(r => linhaHtml(I.cab, r)).join('') + '</ul>' : '<p>Nada nesta lista.</p>') + (I.nota ? '<p class="nota">' + h(I.nota) + '</p>' : '');
      else corpo = (I.resumo ? '<p>' + h(I.resumo) + '</p>' : '') + I.tabelas.map(tb => '<ul class="lista">' + tb.linhas.map(r => linhaHtml(tb.cab, r)).join('') + '</ul>').join('<hr>') || '<p>Nada nesta lista.</p>';
      const n = I.obras ? I.obras.length : I.linhas ? I.linhas.length : (I.tabelas || []).reduce((a, t) => a + t.linhas.length, 0);
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>' + h(String(c ? c.t : s.t).replace(/\s*\(\d+\)\s*$/, '')) + ' (' + n + ')</h2><p class="nota">' + h(c ? s.t + ' · ' : '') + 'Só para ler — trata-se no PC.</p>' + corpo + '</div>';
      m.onclick = e => {
        if (e.target.closest('.voltar')) { ecraExtra = antExtra; aba = ant; return desenhar(); }
        const li = e.target.closest('li[data-id]'); if (li) return abrirObra((D.obras || []).find(w => String(w.id) === li.dataset.id));
        const lr = e.target.closest('li[data-ref]'); if (lr && lr.dataset.ref) abrirObra(obraPorRef(lr.dataset.ref));
      };
    };
    desenhar(); window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------- v238: «O que falta fazer» (as bolas da Principal do PC) */
  const estilo238 = document.createElement('style');
  estilo238.textContent = '.bolas238{list-style:none;margin:0;padding:0}.bolas238 li{display:flex;align-items:center;gap:12px;padding:11px 2px;border-bottom:1px solid var(--linha);font-size:16px;cursor:pointer}.bolas238 li:last-child{border-bottom:0}' +
    '.bolas238 i,.bola238{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:30px;padding:0 7px;border-radius:15px;color:#fff;font-style:normal;font-weight:700;font-size:15px;flex:none}.bolas238 span{flex:1}.bolas238 b{color:var(--suave);font-size:20px;font-weight:400}' +
    '.bola238{vertical-align:middle;margin-right:6px}.atraso238{color:#b3261e;font-weight:600}';
  document.head.append(estilo238);
  function vFalta(m) {
    const F = D.avisos.faltaV300, B = F.bolas || [];
    m.innerHTML = topo() + '<div class="cartao"><h3>O que falta fazer</h3>' + (B.length ? '<ul class="bolas238">' + B.map((b, i) => '<li data-b="' + i + '"><i style="background:' + h(b.cor) + '">' + h(b.n) + '</i><span>' + h(b.t) + '</span><b>›</b></li>').join('') + '</ul>' : '<p>✔ Tudo em dia.</p>') + '</div>' +
      '<p class="nota">Como no ecrã inicial do PC em ' + h(quando(F.em)) + '. Toque numa bola para ver o que há a fazer — só para ver; trata-se no PC.</p>';
    m.onclick = e => { const li = e.target.closest('[data-b]'); if (li) abrirBola(B[+li.dataset.b]); };
  }
  function abrirBola(b) {
    if (!b) return;
    const ant = aba;
    ecraExtra = m => {
      const hj = diaLocal(new Date());
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2><i class="bola238" style="background:' + h(b.cor) + '">' + h(b.n) + '</i>' + h(b.t) + '</h2><p class="nota">Só para ver — trata-se no PC.</p>' +
        ((b.itens || []).length ? '<ul class="lista">' + b.itens.map(x => {
          const w = x.ref && obraPorRef(x.ref), atras = x.prazo && String(x.prazo).slice(0, 10) < hj;
          return '<li class="' + (w ? 'toque' : '') + '" data-ref="' + (w ? h(x.ref) : '') + '"><div class="t">' + h(oc(x.t)) + '</div>' + (x.s ? '<div>' + h(oc(x.s)) + '</div>' : '') +
            (x.prazo ? '<div class="s' + (atras ? ' atraso238' : '') + '">Prazo ' + h(dpt(String(x.prazo).slice(0, 10))) + (atras ? ' — em atraso' : '') + '</div>' : '') + (w ? '<div class="s">Toque para ver a proposta</div>' : '') + '</li>';
        }).join('') + '</ul>' : '<p>Nada nesta lista.</p>') + '</div>';
      m.onclick = e => {
        if (e.target.closest('.voltar')) { ecraExtra = null; aba = ant; return desenhar(); }
        const li = e.target.closest('li[data-ref]'); if (li && li.dataset.ref) abrirObra(obraPorRef(li.dataset.ref));
      };
    };
    desenhar(); window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------- v239: reagendar */
  function formReagendar(e) {
    const m = $('#m'), dia = String(e.inicio || '').slice(0, 10), hi = e.diaTodo ? '' : String(e.inicio || '').slice(11, 16), hf = e.diaTodo ? '' : String(e.fim || '').slice(11, 16);
    const daProposta = /^w:/.test(String(e.id));
    m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>📅 Reagendar</h2><p><b>' + h(e.titulo) + '</b><br><span class="s">Agora: ' + h(dpt(dia)) + (e.diaTodo ? ' (dia inteiro)' : ' ' + h(hi) + (hf && hf !== hi ? '–' + h(hf) : '')) + '</span></p>' +
      '<label class="campo"><span>Novo dia</span><input type="date" id="rgd" value="' + h(dia) + '"></label>' +
      '<label class="campo" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="rgt"' + (e.diaTodo ? ' checked' : '') + ' style="width:22px;height:22px"> Dia inteiro</label>' +
      '<div class="linha"><label class="campo" style="flex:1"><span>Início</span><input type="time" id="rgi" value="' + h(hi) + '"></label><label class="campo" style="flex:1"><span>Fim</span><input type="time" id="rgf" value="' + h(hf) + '"></label></div>' +
      '<p class="erro" id="rge"></p><p class="linha"><button class="btn" data-rgs>Guardar</button></p>' +
      '<p class="nota">' + (daProposta ? 'A data muda também na ficha da proposta, no PC (e no Outlook).' : 'Muda na agenda do PC.') + (gLigado() ? ' Passa sozinho para o PC.' : ' Para passar sozinho, ligue ao Google Drive em Ferramentas.') + '</p></div>';
    m.onclick = async ev => {
      if (ev.target.closest('.voltar')) return desenhar();
      if (!ev.target.closest('[data-rgs]')) return;
      const d = $('#rgd').value, todo = $('#rgt').checked, a = $('#rgi').value, b = $('#rgf').value;
      if (!d) return $('#rge').textContent = 'Escolha o dia.';
      if (!todo && !a) return $('#rge').textContent = 'Indique a hora de início (ou marque «Dia inteiro»).';
      const { pendente, pronta, editavel, ...base } = e;
      await acaoAgenda('alterar', Object.assign({}, base, { inicio: d + 'T' + (todo ? '00:00' : a), fim: d + 'T' + (todo ? '23:59' : (b || a)), diaTodo: todo }));
      aviso(gLigado() ? 'Reagendada — vai para o PC' : 'Reagendada'); aba = 'agenda'; desenhar();
    };
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------- v239: ⏱ Tempos (registo de ponto) */
  const TIPOSP = [['', 'Trabalho'], ['falta', 'Falta'], ['falta_just', 'Falta justificada'], ['ferias', 'Férias'], ['baixa', 'Baixa'], ['folga', 'Folga / compensação']];
  const TIPOP = Object.fromEntries(TIPOSP);
  const minT = t => { const x = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return x ? +x[1] * 60 + +x[2] : null; };
  const fmtT = m => Math.floor(m / 60) + 'h ' + String(Math.round(m % 60)).padStart(2, '0') + 'm';
  const agoraHM = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  let tCid = (() => { try { return localStorage.getItem('gv_t_cid') || ''; } catch (_) { return ''; } })(), tObra = '';
  let tFase = (() => { try { return localStorage.getItem('gv_t_fase') || ''; } catch (_) { return ''; } })();   // v242
  const refEst = () => String(new Date().getFullYear()).slice(2) + 'COM000';
  function faseSel(id, atual) {   // v242: fases vindas do PC (Recursos Humanos › Parâmetros)
    const F = (D && D.fasesV307) || {}, ob = (F.obra && F.obra.length ? F.obra : ['Instalação', 'Produção']), es = (F.estrutura && F.estrutura.length ? F.estrutura : ['Administrativo', 'Comercial', 'Compras']);
    const op = v => '<option' + (v === atual ? ' selected' : '') + '>' + h(v) + '</option>';
    return '<select id="' + id + '"><option value="">—</option><optgroup label="Obra">' + ob.map(op).join('') + '</optgroup><optgroup label="Estrutura (' + refEst() + ')">' + es.map(op).join('') + '</optgroup></select>';
  }
  const refletida = n => n.guardadaEm && D && D.geradoEm && (new Date(D.geradoEm) - new Date(n.guardadaEm) > 4 * 60000);
  function pontoDe(cid) {
    const P = JSON.parse(JSON.stringify(((D && D.pontoRecente) || {})[cid] || {}));
    const L = vivas().filter(n => n.tipoNota === 'ponto' && n.cid === cid && !refletida(n)).sort((a, b) => String(a.criada).localeCompare(String(b.criada)));
    for (const n of L) {
      const r = P[n.dia] = P[n.dia] || { marcas: [], tipo: '', nota: '' };
      if (n.acao === 'marca') { const x = r.marcas.find(y => y.id && y.id === n.marcaId); if (x) Object.assign(x, { e: n.e, s: n.s || '', obra: n.obraRef || '', fase: n.fase || '', pend: true }); else r.marcas.push({ e: n.e, s: n.s || '', obra: n.obraRef || '', fase: n.fase || '', id: n.marcaId, origem: 'telemóvel', pend: true }); }
      else if (n.acao === 'fecha') { const x = r.marcas.find(y => !y.s); if (x) { x.s = n.s; x.pend = true; } }
      else if (n.acao === 'tipo') { r.tipo = n.tipo || ''; if (n.nota != null) r.nota = n.nota; r.pend = true; }
      else if (n.acao === 'tirar') { const i = r.marcas.findIndex(y => y.id === n.marcaId); if (i >= 0) r.marcas.splice(i, 1); }
    }
    return P;
  }
  const totalDia = (r, hojeK, k) => (r && r.marcas || []).reduce((a, x) => { const e = minT(x.e); if (e == null) return a; const s = x.s ? minT(x.s) : (k === hojeK ? minT(agoraHM()) : null); return s == null ? a : a + (s >= e ? s - e : s + 1440 - e); }, 0);
  async function gravarPonto(o) {
    const c = (D.colaboradores || []).find(x => x.id === o.cid) || {}, agora = new Date().toISOString();
    N.push(Object.assign({ id: novoId(), criada: agora, alterada: agora, tipoNota: 'ponto', assunto: 'Tempos: ' + (c.nome || ''), guardadaEm: '' }, o));
    await guardarNotas();
    if (!gLigado()) aviso('Gravado. Use «Guardar anotações» em Notas para passar ao PC.');
  }
  function vTempos(m) {
    const C = D.colaboradores;
    if (!Array.isArray(C) || !C.length) { m.innerHTML = topo() + '<div class="cartao"><h2>⏱ Tempos</h2><p>O ficheiro do PC ainda não traz os colaboradores. Instale no PC a versão 301 (e tenha colaboradores ativos em Recursos Humanos) e carregue em ⟳ Atualizar.</p></div>'; return; }
    if (!C.some(c => c.id === tCid)) tCid = C[0].id;
    const P = pontoDe(tCid), hj = diaLocal(new Date()), ab = ((P[hj] || {}).marcas || []).find(x => !x.s);
    const refs = '<option value="' + refEst() + '">Estrutura do ano (administrativo, comercial, compras)</option>' + (D.obras || []).filter(ativa).map(w => '<option value="' + h(w.ref) + '">' + h(w.description || '') + '</option>').join('');   // v242
    const dias = []; for (let i = 0; i < 14; i++) { const d = new Date(); d.setDate(d.getDate() - i); dias.push(diaLocal(d)); }
    const seg = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return diaLocal(d); })();
    const semana = dias.filter(k => k >= seg).reduce((a, k) => a + totalDia(P[k], hj, k), 0);
    const nomeDia = k => (k === hj ? 'Hoje · ' : '') + new Date(k + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: '2-digit' });
    m.innerHTML = topo() + '<div class="cartao"><label class="campo"><span>Pessoa</span><select id="tc">' + C.map(c => '<option value="' + h(c.id) + '"' + (c.id === tCid ? ' selected' : '') + '>' + h(c.nome) + (c.funcao ? ' — ' + h(c.funcao) : '') + '</option>').join('') + '</select></label>' +
      (ab ? '<p><b>Em curso</b> desde as ' + h(ab.e) + (ab.obra ? ' · ' + h(ab.obra) : '') + '</p><p class="linha"><button class="btn" data-tsai>⏹ Saída agora (' + h(agoraHM()) + ')</button></p>'
        : '<label class="campo"><span>Obra (opcional)</span><input id="to" list="tlo" value="' + h(tObra) + '" placeholder="Referência da obra"></label><datalist id="tlo">' + refs + '</datalist><label class="campo"><span>Fase</span>' + faseSel('tfa', tFase) + '</label><p class="linha"><button class="btn" data-tent>▶ Entrada agora (' + h(agoraHM()) + ')</button></p>') +
      '<p class="linha"><button class="btn sec peq" data-tnovo>+ Lançar tempo à mão</button><button class="btn sec peq" data-ttipo>Falta, férias, baixa ou folga</button></p></div>' +
      '<div class="cartao"><h3>Últimos 14 dias · esta semana ' + fmtT(semana) + '</h3>' + dias.map(k => { const r = P[k], tm = totalDia(r, hj, k); if (!r || (!(r.marcas || []).length && !r.tipo && !r.nota)) return '';
        return '<div style="border-top:1px solid var(--linha);padding:6px 0"><div class="sec-t"><b>' + h(nomeDia(k)) + '</b><span>' + (tm ? fmtT(tm) : '') + '</span></div>' + (r.tipo ? '<span class="chip am">' + h(TIPOP[r.tipo] || r.tipo) + '</span>' : '') + (r.nota ? '<div class="s">' + h(r.nota) + '</div>' : '') +
          (r.marcas || []).map(x => '<div class="linha" style="justify-content:space-between;margin:3px 0"><span>' + h(x.e) + '–' + h(x.s || 'em curso') + (x.obra ? ' · <b>' + h(x.obra) + '</b>' : '') + (x.fase ? ' · ' + h(x.fase) : '') + ' <span class="s">' + (x.origem === 'telemóvel' ? 'telemóvel' : 'PC') + (x.pend ? ' · por passar ao PC' : '') + '</span></span>' +
            (x.id ? '<span><button class="btn sec peq" data-tedit="' + h(k) + '|' + h(x.id) + '">✎</button> <button class="btn sec peq" data-ttir="' + h(k) + '|' + h(x.id) + '">✖</button></span>' : '') + '</div>').join('') + '</div>'; }).join('') +
      '<p class="nota">Vai para o Registo de ponto do PC (Recursos Humanos). As marcas feitas no PC corrigem-se no PC. Nada se apaga: as correções ficam registadas.</p></div>';
    $('#tc').onchange = ev => { tCid = ev.target.value; try { localStorage.setItem('gv_t_cid', tCid); } catch (_) { } vTempos(m); };
    const to = $('#to'); if (to) to.oninput = () => { tObra = to.value; };
    m.onclick = async e => {
      if (e.target.closest('[data-tent]')) { tObra = ($('#to') || {}).value || ''; tFase = ($('#tfa') || {}).value || ''; try { localStorage.setItem('gv_t_fase', tFase); } catch (_) { } await gravarPonto({ cid: tCid, dia: hj, acao: 'marca', marcaId: 't' + novoId(), e: agoraHM(), s: '', obraRef: tObra.trim().toUpperCase(), fase: tFase }); return desenhar(); }
      if (e.target.closest('[data-tsai]')) { const s = agoraHM(); await gravarPonto(ab.id ? { cid: tCid, dia: hj, acao: 'marca', marcaId: ab.id, e: ab.e, s, obraRef: ab.obra || '', fase: ab.fase || '' } : { cid: tCid, dia: hj, acao: 'fecha', s }); return desenhar(); }
      if (e.target.closest('[data-tnovo]')) return formTempo(tCid, hj, null);
      if (e.target.closest('[data-ttipo]')) return formTipoDia(tCid, hj, P);
      const ed = e.target.closest('[data-tedit]'); if (ed) { const [k, id] = ed.dataset.tedit.split('|'); const x = ((P[k] || {}).marcas || []).find(y => y.id === id); if (x) formTempo(tCid, k, x); return; }
      const tr = e.target.closest('[data-ttir]'); if (tr) { const [k, id] = tr.dataset.ttir.split('|'); const x = ((P[k] || {}).marcas || []).find(y => y.id === id); if (x && confirm('Tirar ' + x.e + '–' + (x.s || 'em curso') + ' de ' + dpt(k) + '?\n\nNo PC fica registado nas correções do dia (nada se apaga).')) { await gravarPonto({ cid: tCid, dia: k, acao: 'tirar', marcaId: id }); desenhar(); } }
    };
  }
  function formTempo(cid, dia, x) {
    const ant = aba, nome = ((D.colaboradores || []).find(c => c.id === cid) || {}).nome || '';
    const refs = '<option value="' + refEst() + '">Estrutura do ano (administrativo, comercial, compras)</option>' + (D.obras || []).filter(ativa).map(w => '<option value="' + h(w.ref) + '">' + h(w.description || '') + '</option>').join('');   // v242
    ecraExtra = m => {
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>' + (x ? 'Corrigir tempo' : 'Lançar tempo') + '</h2><p><b>' + h(nome) + '</b></p>' +
        '<label class="campo"><span>Dia</span><input type="date" id="fd" value="' + h(dia) + '"' + (x ? ' disabled' : '') + '></label>' +
        '<div class="linha"><label class="campo" style="flex:1"><span>Entrada</span><input type="time" id="fe" value="' + h(x ? x.e : '') + '"></label><label class="campo" style="flex:1"><span>Saída</span><input type="time" id="fs" value="' + h(x ? x.s : '') + '"></label></div>' +
        '<label class="campo"><span>Obra (opcional)</span><input id="fo" list="flo" value="' + h(x ? x.obra : tObra) + '" placeholder="Referência da obra"></label><datalist id="flo">' + refs + '</datalist>' +
        '<label class="campo"><span>Fase</span>' + faseSel('ffa', x ? (x.fase || '') : tFase) + '</label>' +   // v242
        '<p class="erro" id="fer"></p><p class="linha"><button class="btn" data-fg>Gravar</button></p><p class="nota">Saída vazia = ainda em curso. ' + (gLigado() ? 'Vai logo para o PC.' : '') + '</p></div>';
      m.onclick = async e => {
        if (e.target.closest('.voltar')) { ecraExtra = null; aba = ant; return desenhar(); }
        if (!e.target.closest('[data-fg]')) return;
        const d = $('#fd').value, a = $('#fe').value, b = $('#fs').value, o = $('#fo').value.trim().toUpperCase();
        if (!d) return $('#fer').textContent = 'Escolha o dia.';
        if (!a) return $('#fer').textContent = 'Indique a hora de entrada.';
        if (b && minT(b) < minT(a) && !confirm('A saída (' + b + ') é antes da entrada (' + a + '): conta como passagem da meia-noite. Continuar?')) return;
        if (o && !obraPorRef(o) && !/^\d{2}COM000$/.test(o) && !confirm('Não encontrei a obra ' + o + ' na lista. Gravar mesmo assim?')) return;
        await gravarPonto({ cid, dia: d, acao: 'marca', marcaId: x ? x.id : 't' + novoId(), e: a, s: b || '', obraRef: o, fase: ($('#ffa') || {}).value || '' });
        ecraExtra = null; aba = 'tempos'; desenhar();
      };
    };
    desenhar(); window.scrollTo(0, 0);
  }
  function formTipoDia(cid, dia, P) {
    const ant = aba, nome = ((D.colaboradores || []).find(c => c.id === cid) || {}).nome || '';
    ecraExtra = m => {
      const r = (P || {})[dia] || {};
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><h2>Tipo do dia</h2><p><b>' + h(nome) + '</b></p>' +
        '<label class="campo"><span>Dia</span><input type="date" id="kd" value="' + h(dia) + '"></label>' +
        '<label class="campo"><span>Tipo</span><select id="kt">' + TIPOSP.map(([v, t]) => '<option value="' + v + '"' + ((r.tipo || '') === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
        '<label class="campo"><span>Nota</span><input id="kn" value="' + h(r.nota || '') + '" placeholder="ex.: consulta médica"></label>' +
        '<p class="linha"><button class="btn" data-kg>Gravar</button></p></div>';
      m.onclick = async e => {
        if (e.target.closest('.voltar')) { ecraExtra = null; aba = ant; return desenhar(); }
        if (!e.target.closest('[data-kg]')) return;
        const d = $('#kd').value; if (!d) return;
        await gravarPonto({ cid, dia: d, acao: 'tipo', tipo: $('#kt').value, nota: $('#kn').value.trim() });
        ecraExtra = null; aba = 'tempos'; desenhar();
      };
    };
    desenhar(); window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------- v240: agenda Mês / Semana / Dia, como no PC, com arrastar */
  const lsG = (k, d) => { try { return localStorage.getItem(k) || d; } catch (_) { return d; } };
  let agVista = lsG('gv_ag_vista', 'sem'), agCur = diaLocal(new Date()), agFT = '', agFR = '', agEv = [], agSupr = 0;
  const DCURTO = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'], MESL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const somaD = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return diaLocal(d); };
  const segD = s => somaD(s, -((new Date(s + 'T12:00:00').getDay() + 6) % 7));
  const FER240 = {};
  function feriado(k) {
    const y = +k.slice(0, 4); if (!FER240[y]) {
      const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), kk = c % 4, l = (32 + 2 * e + 2 * i - hh - kk) % 7, mm = Math.floor((a + 11 * hh + 22 * l) / 451), mes = Math.floor((hh + l - 7 * mm + 114) / 31), dia = ((hh + l - 7 * mm + 114) % 31) + 1;
      const P = diaLocal(new Date(y, mes - 1, dia)), o = {};
      [['01-01', 'Ano Novo'], ['04-25', 'Dia da Liberdade'], ['05-01', 'Dia do Trabalhador'], ['06-10', 'Dia de Portugal'], ['08-15', 'Assunção de N. Senhora'], ['10-05', 'Implantação da República'], ['11-01', 'Todos os Santos'], ['12-01', 'Restauração da Independência'], ['12-08', 'Imaculada Conceição'], ['12-25', 'Natal']].forEach(([md, n]) => { o[y + '-' + md] = n; });
      o[somaD(P, -2)] = 'Sexta-feira Santa'; o[P] = 'Páscoa'; o[somaD(P, 60)] = 'Corpo de Deus'; FER240[y] = o;
    }
    return FER240[y][k] || '';
  }
  const podeMover = e => !e.pedido && e.editavel !== false && (!/^w:/.test(String(e.id)) || /^w:\d+:[vi]$/.test(String(e.id)));
  function agEventos() {
    const tratado = n => n.guardadaEm && D.geradoEm && new Date(D.geradoEm) > new Date(n.guardadaEm) && !(D.notas || []).some(x => x.origemId === n.id);
    const pedidos = vivas().filter(n => n.analise && n.analise.tipo === 'agenda' && n.analise.inicio && !tratado(n))
      .map(n => ({ id: 'p:' + n.id, pedido: true, notaId: n.id, tipo: 'Pedido', titulo: n.assunto || 'Nota', inicio: n.analise.inicio, fim: n.analise.inicio, local: [n.morada, n.localidade].filter(Boolean).join(', ') }));
    return [...agendaComPendentes(), ...pedidos].filter(e => e.inicio && (!agFT || e.tipo === agFT) && (!agFR || (e.tecnico || '') === agFR)).sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
  }
  const noDiaA = (L, d) => L.filter(e => String(e.inicio).slice(0, 10) <= d && String(e.fim || e.inicio).slice(0, 10) >= d);
  const horaA = e => e.diaTodo ? 'Dia inteiro' : String(e.inicio).slice(11, 16);
  const chipA = (e, est) => '<div class="agc' + (podeMover(e) ? ' mv' : '') + (e.pendente ? ' pend' : '') + '" data-ev="' + h(e.id) + '" style="background:' + (CORAG[e.tipo] || CORAG.Outro) + ';' + (est || '') + '">' + (e.diaTodo ? '' : '<b>' + h(String(e.inicio).slice(11, 16)) + '</b> ') + h(e.titulo) + (e.pronta ? ' ✔' : '') + '</div>';
  const est240 = document.createElement('style');
  est240.textContent = '.agbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 8px}.agbar .ttl{flex:1;text-align:center;font-weight:700;min-width:120px}.agbar select{width:auto;padding:6px;font-size:14px}' +
    '.agm{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}.agm .cab{font-size:11px;font-weight:600;text-align:center;color:var(--suave)}.agm .d{min-height:74px;background:#fff;border:1px solid var(--linha);border-radius:6px;padding:2px;overflow:hidden;cursor:pointer}' +
    '.agm .d.fora{opacity:.45}.agm .d.vazio{background:transparent;border:0;cursor:default;min-height:0}.agm .d.fs{background:#eef1f4}.agm .d.fer{background:#efe8f3}.agm .d.hoje{border-color:var(--azul2);border-width:2px}.agm .n{font-size:12px;font-weight:600}.agm .mais{font-size:10px;color:var(--suave)}' +
    '.agc{color:#fff;border-radius:5px;padding:2px 4px;margin:2px 0;font-size:11px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}.agc.pend{outline:2px dashed #b86e00;outline-offset:-2px}' +
    '.agw .agc{font-size:13px;padding:6px 8px;white-space:normal}.agw h3{display:flex;justify-content:space-between}.agw.fs{background:#f4f6f8}' +
    '.agg{position:relative;border-left:1px solid var(--linha);margin-left:44px}.agg .hl{position:absolute;left:-44px;right:0;border-top:1px solid #e6ecf0;font-size:11px;color:var(--suave)}.agg .agc{position:absolute;left:4px;right:4px;white-space:normal;font-size:12px}' +
    '.agsobre{outline:3px solid var(--azul2)!important;outline-offset:-3px}.agc.agarr{opacity:.35}.agf{position:fixed;z-index:50;pointer-events:none;width:160px;box-shadow:0 6px 16px #0006;opacity:.95}';
  document.head.append(est240);
  function barraAg(titulo) {
    const tipos = [...new Set([...TIPOSAG, ...(D.agenda || []).map(e => e.tipo).filter(Boolean)])], resps = [...new Set((D.agenda || []).map(e => e.tecnico).filter(Boolean))];
    return '<div class="filtros">' + [['mes', 'Mês'], ['sem', 'Semana'], ['dia', 'Dia'], ['lista', 'Lista']].map(([k, n]) => '<button data-agv="' + k + '" class="' + (agVista === k ? 'on' : '') + '">' + n + '</button>').join('') + '</div>' +
      (agVista !== 'lista' ? '<div class="agbar"><button class="btn sec peq" data-agn2="-1">‹</button><button class="btn sec peq" data-agh>Hoje</button><span class="ttl">' + h(titulo) + '</span><button class="btn sec peq" data-agn2="1">›</button></div>' : '') +
      '<div class="agbar"><select id="agft"><option value="">Todos os tipos</option>' + tipos.map(x => '<option' + (x === agFT ? ' selected' : '') + '>' + h(x) + '</option>').join('') + '</select>' +
      (resps.length ? '<select id="agfr"><option value="">Todos os responsáveis</option>' + resps.map(x => '<option' + (x === agFR ? ' selected' : '') + '>' + h(x) + '</option>').join('') + '</select>' : '') + '<button class="btn peq" data-agn>+ Nova</button></div>';
  }
  function vAgenda(m) {
    if (!Array.isArray(D.agenda)) return vAgendaLista(m);
    if (agVista === 'lista') {
      vAgendaLista(m); const tp = m.querySelector('p.nota'); const bar = document.createElement('div'); bar.innerHTML = barraAg(''); (tp || m.firstChild) ? m.insertBefore(bar, tp ? tp.nextSibling : m.firstChild) : m.prepend(bar);
      const antes = m.onclick; m.onclick = e => { if (barraCliques(e, m)) return; antes && antes(e); }; ligaFiltros(m); return;
    }
    agEv = agEventos(); const L = agEv, hj = diaLocal(new Date());
    let titulo = '', corpo = '';
    if (agVista === 'mes') {
      titulo = MESL[+agCur.slice(5, 7) - 1] + ' ' + agCur.slice(0, 4);
      const ini = segD(agCur.slice(0, 8) + '01'); let s = DCURTO.map(n => '<div class="cab">' + n + '</div>').join('');
      for (let i = 0; i < 42; i++) { const d = somaD(ini, i); if (i === 35 && d.slice(0, 7) !== agCur.slice(0, 7)) break; if (d.slice(0, 7) !== agCur.slice(0, 7)) { s += '<div class="d vazio"></div>'; continue; }   /* v241: só os dias do mês */ const es = noDiaA(L, d), wd = new Date(d + 'T12:00:00').getDay();
        s += '<div class="d' + (d.slice(0, 7) !== agCur.slice(0, 7) ? ' fora' : '') + (wd === 0 || wd === 6 ? ' fs' : '') + (feriado(d) ? ' fer' : '') + (d === hj ? ' hoje' : '') + '" data-dz data-dia="' + d + '" title="' + h(feriado(d)) + '"><div class="n">' + +d.slice(8) + '</div>' + es.slice(0, 3).map(e => chipA(e)).join('') + (es.length > 3 ? '<div class="mais">+' + (es.length - 3) + '</div>' : '') + '</div>'; }
      corpo = '<div class="agm">' + s + '</div><p class="nota">Toque num dia para o abrir. Para mudar de dia, mantenha o dedo numa marcação e arraste-a.</p>';
    } else if (agVista === 'sem') {
      const s0 = segD(agCur); titulo = dpt(s0).slice(0, 5) + ' – ' + dpt(somaD(s0, 6));
      corpo = Array.from({ length: 7 }, (_, i) => { const d = somaD(s0, i), es = noDiaA(L, d), wd = new Date(d + 'T12:00:00').getDay();
        return '<div class="cartao agw' + (wd === 0 || wd === 6 || feriado(d) ? ' fs' : '') + '" data-dz data-dia="' + d + '"><h3><span>' + (d === hj ? 'Hoje · ' : '') + DCURTO[i] + ' ' + dpt(d).slice(0, 5) + (feriado(d) ? ' · ' + h(feriado(d)) : '') + '</span><button class="btn sec peq" data-agd="' + d + '">Dia ›</button></h3>' + (es.length ? es.map(e => chipA(e)).join('') : '<p class="nota" style="margin:0">—</p>') + '</div>'; }).join('') +
        '<p class="nota">Mantenha o dedo numa marcação e arraste-a para outro dia.</p>';
    } else {
      titulo = (agCur === hj ? 'Hoje · ' : '') + new Date(agCur + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) + (feriado(agCur) ? ' · ' + feriado(agCur) : '');
      const es = noDiaA(L, agCur), todo = es.filter(e => e.diaTodo || String(e.inicio).slice(0, 10) !== String(e.fim || e.inicio).slice(0, 10)), hrs = es.filter(e => !todo.includes(e)), HI = 7, HF = 22, PXH = 48;
      const mins = s => +String(s).slice(11, 13) * 60 + +String(s).slice(14, 16);
      const fins = [], col = hrs.map(e => { let i = fins.findIndex(f => f <= e.inicio); if (i < 0) { i = fins.length; fins.push(''); } fins[i] = e.fim || e.inicio; return i; }), nc = Math.max(1, fins.length);
      corpo = (todo.length ? '<div class="cartao" data-dz data-dia="' + agCur + '">' + todo.map(e => chipA(e)).join('') + '</div>' : '') +
        '<div class="cartao" style="padding:8px 6px"><div class="agg" data-grade="' + agCur + '" style="height:' + (HF - HI) * PXH + 'px">' + Array.from({ length: HF - HI }, (_, i) => '<div class="hl" style="top:' + i * PXH + 'px">' + (HI + i) + ':00</div>').join('') +
        hrs.map((e, k) => { const a = Math.max(mins(e.inicio), HI * 60), b = Math.max(a + 20, Math.min(mins(e.fim || e.inicio), HF * 60)); return chipA(e, 'top:' + (a - HI * 60) / 60 * PXH + 'px;height:' + ((b - a) / 60 * PXH - 2) + 'px;left:calc(' + (col[k] / nc * 100) + '% + 4px);width:calc(' + (100 / nc) + '% - 8px);right:auto'); }).join('') + '</div></div>' +
        '<p class="nota">Toque numa hora livre para marcar a essa hora. Mantenha o dedo numa marcação e arraste-a para outra hora.</p>';
    }
    m.innerHTML = topo() + barraAg(titulo) + corpo + '<p class="nota">Agenda do PC. O que muda aqui passa sozinho para o PC' + (gLigado() ? '.' : ' depois de ligar ao Google Drive (Ferramentas › Entrada e versão).') + '</p>';
    ligaFiltros(m); ligaArrastar(m);
    m.onclick = e => {
      if (barraCliques(e, m)) return;
      if (Date.now() - agSupr < 600) return;
      const c = e.target.closest('.agc[data-ev]'); if (c) { const x = agEv.find(y => String(y.id) === c.dataset.ev); if (x) abrirEventoA(x); return; }
      const bd = e.target.closest('[data-agd]'); if (bd) { agCur = bd.dataset.agd; agVista = 'dia'; return vAgenda(m); }
      const g = e.target.closest('[data-grade]'); if (g) { const y = e.clientY - g.getBoundingClientRect().top, mi = Math.max(7 * 60, Math.min(21 * 60, Math.floor((7 * 60 + y / 48 * 60) / 30) * 30)); return novaA(g.dataset.grade, String(Math.floor(mi / 60)).padStart(2, '0') + ':' + String(mi % 60).padStart(2, '0')); }
      const dz = e.target.closest('.agm [data-dia]'); if (dz) { agCur = dz.dataset.dia; agVista = 'dia'; return vAgenda(m); }
    };
  }
  function barraCliques(e, m) {
    const v = e.target.closest('[data-agv]'); if (v) { agVista = v.dataset.agv; try { localStorage.setItem('gv_ag_vista', agVista); } catch (_) { } vAgenda(m); return true; }
    const n2 = e.target.closest('[data-agn2]'); if (n2) { const k = +n2.dataset.agn2; if (agVista === 'mes') { const d = new Date(agCur.slice(0, 8) + '01T12:00:00'); d.setMonth(d.getMonth() + k); agCur = diaLocal(d); } else agCur = somaD(agCur, k * (agVista === 'sem' ? 7 : 1)); vAgenda(m); return true; }
    if (e.target.closest('[data-agh]')) { agCur = diaLocal(new Date()); vAgenda(m); return true; }
    if (e.target.closest('[data-agn]')) { novaA(agVista === 'dia' ? agCur : '', ''); return true; }
    return false;
  }
  function ligaFiltros(m) {
    const ft = m.querySelector('#agft'), fr = m.querySelector('#agfr');
    if (ft) ft.onchange = () => { agFT = ft.value; vAgenda(m); };
    if (fr) fr.onchange = () => { agFR = fr.value; vAgenda(m); };
  }
  function novaA(dia, hora) {
    formAgenda(null);
    if (dia && $('#agd')) $('#agd').value = dia;
    if (hora && $('#aghi')) { $('#aghi').value = hora; const [hh, mm] = hora.split(':').map(Number); if ($('#aghf')) $('#aghf').value = String(Math.min(23, hh + 1)).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); }
  }
  function abrirEventoA(e) {
    const ant = aba;
    ecraExtra = m => {
      m.innerHTML = '<button class="voltar">‹ Voltar</button><div class="cartao"><div style="display:flex;gap:8px;align-items:center"><span class="ag-c" style="background:' + (CORAG[e.tipo] || CORAG.Outro) + ';width:14px;height:14px;border-radius:7px;display:inline-block"></span><h2 style="margin:0">' + h(e.titulo) + '</h2></div>' +
        '<dl class="det"><dt>Quando</dt><dd>' + h(dpt(String(e.inicio).slice(0, 10))) + ' · ' + h(horaA(e)) + (!e.diaTodo && e.fim && String(e.fim).slice(0, 10) === String(e.inicio).slice(0, 10) ? '–' + h(String(e.fim).slice(11, 16)) : '') + '</dd>' +
        '<dt>Tipo</dt><dd>' + h(e.tipo || '—') + (e.pendente ? ' <span class="chip am">por passar ao PC</span>' : '') + (e.pronta ? ' <span class="chip ok">✔ Pronta</span>' : '') + '</dd>' +
        (e.cliente || e.fornecedor || e.tecnico ? '<dt>Com</dt><dd>' + h([e.cliente, e.fornecedor, e.tecnico].filter(Boolean).join(' · ')) + '</dd>' : '') +
        (e.local ? '<dt>Local</dt><dd>' + mapa(e.local) + '</dd>' : '') + (e.notas ? '<dt>Notas</dt><dd style="white-space:pre-wrap">' + h(e.notas) + '</dd>' : '') + '</dl>' +
        botoesAg(e) + (e.ref && obraPorRef(e.ref) ? '<p class="linha" style="margin-top:8px"><button class="btn sec peq" data-agobra>Ver a proposta ' + h(e.ref) + '</button></p>' : '') + '</div>';
      m.onclick = async ev => {
        if (ev.target.closest('.voltar')) { ecraExtra = null; aba = ant; return desenhar(); }
        if (ev.target.closest('a')) return;
        if (ev.target.closest('[data-agobra]')) { ecraExtra = null; return abrirObra(obraPorRef(e.ref)); }
        if (ev.target.closest('[data-agp]')) { if (confirm('Marcar a visita «' + e.titulo + '» como pronta?')) { await acaoAgenda('pronta', { id: e.id, titulo: e.titulo }); ecraExtra = null; aba = 'agenda'; desenhar(); } return; }
        if (ev.target.closest('[data-age]')) { ecraExtra = null; return formAgenda(e); }
        if (ev.target.closest('[data-agr]')) { ecraExtra = null; return formReagendar(e); }
      };
    };
    desenhar(); window.scrollTo(0, 0);
  }
  function ligaArrastar(m) {
    let zonaAtual = null;
    const marca = z => { if (zonaAtual === z) return; if (zonaAtual) zonaAtual.classList.remove('agsobre'); zonaAtual = z; if (z) z.classList.add('agsobre'); };
    const zonaEm = (x, y) => { const el = document.elementFromPoint(x, y); return el ? (el.closest('[data-grade]') || el.closest('[data-dz]')) : null; };
    m.querySelectorAll('.agc.mv[data-ev]').forEach(el => {
      let t = null, ativo = false, fant = null, x0 = 0, y0 = 0, dy = 0;
      const comeca = (x, y) => { ativo = true; el.classList.add('agarr'); dy = y - el.getBoundingClientRect().top; fant = el.cloneNode(true); fant.classList.add('agf'); fant.classList.remove('agarr'); document.body.append(fant); mexe(x, y); try { navigator.vibrate && navigator.vibrate(25); } catch (_) { } };
      const mexe = (x, y) => { if (!fant) return; fant.style.left = Math.max(4, x - 60) + 'px'; fant.style.top = (y - 14) + 'px'; marca(zonaEm(x, y)); };
      const acaba = (x, y) => { clearTimeout(t); if (!ativo) return; ativo = false; agSupr = Date.now(); el.classList.remove('agarr'); if (fant) fant.remove(); fant = null; const z = zonaEm(x, y); marca(null); if (z) largarA(el.dataset.ev, z, y, dy, m); };
      el.addEventListener('touchstart', ev => { const p = ev.touches[0]; x0 = p.clientX; y0 = p.clientY; clearTimeout(t); t = setTimeout(() => comeca(x0, y0), 450); }, { passive: true });
      el.addEventListener('touchmove', ev => { const p = ev.touches[0]; if (!ativo) { if (Math.hypot(p.clientX - x0, p.clientY - y0) > 8) clearTimeout(t); return; } ev.preventDefault(); x0 = p.clientX; y0 = p.clientY; mexe(x0, y0); }, { passive: false });
      el.addEventListener('touchend', ev => { const p = ev.changedTouches[0]; if (ativo) ev.preventDefault(); acaba(p.clientX, p.clientY); });
      el.addEventListener('touchcancel', () => { clearTimeout(t); if (ativo) { ativo = false; el.classList.remove('agarr'); if (fant) fant.remove(); fant = null; marca(null); } });
      el.addEventListener('contextmenu', ev => ev.preventDefault());
      el.addEventListener('mousedown', ev => {
        if (ev.button !== 0) return; const mx = ev.clientX, my = ev.clientY;
        const mv = e2 => { if (!ativo && Math.hypot(e2.clientX - mx, e2.clientY - my) > 6) comeca(e2.clientX, e2.clientY); else if (ativo) mexe(e2.clientX, e2.clientY); };
        const up = e2 => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); acaba(e2.clientX, e2.clientY); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      });
    });
  }
  async function largarA(id, z, y, dy, m) {
    const e = agEv.find(x => String(x.id) === String(id)); if (!e) return;
    let d = z.dataset.grade || z.dataset.dia, hhmm = String(e.inicio).slice(11, 16);
    if (z.dataset.grade && !e.diaTodo) { const mi = Math.max(0, Math.min(23 * 60 + 45, Math.round((7 * 60 + (y - dy - z.getBoundingClientRect().top) / 48 * 60) / 15) * 15)); hhmm = String(Math.floor(mi / 60)).padStart(2, '0') + ':' + String(mi % 60).padStart(2, '0'); }
    const ini = d + 'T' + hhmm; if (ini === e.inicio) return;
    const dur = Math.max(15 * 60000, new Date(e.fim || e.inicio) - new Date(e.inicio)), f = new Date(new Date(ini).getTime() + dur);
    const fim = e.diaTodo ? d + 'T' + String(e.fim || e.inicio).slice(11, 16) : diaLocal(f) + 'T' + String(f.getHours()).padStart(2, '0') + ':' + String(f.getMinutes()).padStart(2, '0');
    if (!confirm('Passar «' + e.titulo + '»\nde ' + dpt(String(e.inicio).slice(0, 10)) + ' ' + horaA(e) + '\npara ' + dpt(d) + (e.diaTodo ? ' (dia inteiro)' : ' ' + hhmm) + '?')) return;
    const { pendente, pronta, editavel, ...base } = e;
    await acaoAgenda('alterar', Object.assign({}, base, { inicio: ini, fim, diaTodo: !!e.diaTodo }));
    aviso(gLigado() ? 'Reagendada — vai para o PC' : 'Reagendada'); vAgenda(m);
  }

  inicio();
})();

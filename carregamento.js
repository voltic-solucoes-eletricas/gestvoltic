/* Módulo «Carregamento de carros elétricos» (separador Ferramentas, v146). Pedido do Jorge (04/11/2026):
   modo 1 — km a recuperar + potência disponível + marca/modelo → horas de carga;
   modo 2 — potência + horas → km ganhos. Sem marca/modelo usa o consumo médio.
   Consumos e carregadores de bordo (AC) são valores típicos, editáveis; o carro nunca carrega acima do seu carregador de
   bordo. Só calcula; não grava nada. Funciona também sozinho (telemóvel/tablet). */
(() => {
  'use strict';
  const ID = 'carregamento-ve';
  const MEDIO = 18;   // kWh/100 km — consumo médio real de um ligeiro elétrico (valor de referência)
  // [marca, modelo, consumo kWh/100 km (típico, real/WLTP), carregador de bordo AC trifásico kW, AC monofásico kW]
  const CARROS = [
    ['BMW', 'i4', 17, 11, 7.4], ['BMW', 'iX1', 17.5, 11, 7.4], ['BYD', 'Atto 3', 16.5, 11, 7], ['BYD', 'Dolphin', 15.5, 11, 7],
    ['Citroën', 'ë-C4', 16.5, 11, 7.4], ['Cupra', 'Born', 16, 11, 7.2], ['Dacia', 'Spring', 14, 7, 7],
    ['Fiat', '500e', 15, 11, 7.4], ['Hyundai', 'Kona Electric', 15.5, 11, 7.4], ['Hyundai', 'Ioniq 5', 18, 11, 7.4],
    ['Kia', 'Niro EV', 16.5, 11, 7.4], ['Kia', 'EV6', 18, 11, 7.4], ['Mercedes', 'EQA', 17.5, 11, 7.4],
    ['MG', 'MG4', 16.5, 11, 6.6], ['MG', 'ZS EV', 18, 11, 7], ['Nissan', 'Leaf', 17, 6.6, 6.6],
    ['Opel', 'Corsa Electric', 16, 11, 7.4], ['Peugeot', 'e-208', 15.5, 11, 7.4], ['Peugeot', 'e-2008', 17, 11, 7.4],
    ['Polestar', '2', 18, 11, 7.4], ['Renault', 'Zoe', 17, 22, 7.4], ['Renault', 'Megane E-Tech', 16, 22, 7.4],
    ['Renault', '5 E-Tech', 15, 11, 7.4], ['Skoda', 'Enyaq', 17.5, 11, 7.2], ['Smart', '#1', 17.5, 22, 7.4],
    ['Tesla', 'Model 3', 14.5, 11, 7.4], ['Tesla', 'Model Y', 16, 11, 7.4], ['Volkswagen', 'ID.3', 16, 11, 7.2],
    ['Volkswagen', 'ID.4', 18, 11, 7.2], ['Volvo', 'EX30', 17, 11, 7.4]
  ];
  const POT = [['2.3', '2,3 kW — tomada doméstica (10 A)'], ['3.7', '3,7 kW — monofásico 16 A'], ['7.4', '7,4 kW — monofásico 32 A'],
    ['11', '11 kW — trifásico 16 A'], ['22', '22 kW — trifásico 32 A'], ['outra', 'Outra potência…']];
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) ? x : NaN; };
  const f = (x, d = 1) => isFinite(x) ? x.toLocaleString('pt-PT', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const hm = horas => { if (!isFinite(horas)) return '—'; const t = Math.round(horas * 60); return Math.floor(t / 60) + ' h ' + String(t % 60).padStart(2, '0') + ' min'; };
  let el = null;
  const s = { modo: 'horas', km: '100', pot: '7.4', potOutra: '', carro: '', cons: '', obc: '', rend: '90', horas: '8' };

  function carro() { return s.carro === '' ? null : CARROS[+s.carro]; }
  function dados() {
    const c = carro();
    const potRede = s.pot === 'outra' ? num(s.potOutra) : num(s.pot);
    const mono = s.pot !== 'outra' ? num(s.pot) <= 7.4 : potRede <= 7.4;
    const obcTab = c ? (mono ? c[4] : c[3]) : NaN;
    const obc = num(s.obc) || obcTab;
    const cons = num(s.cons) || (c ? c[2] : MEDIO);
    const pot = isFinite(obc) ? Math.min(potRede, obc) : potRede;
    const rend = (num(s.rend) || 90) / 100;
    return { c, potRede, obc, cons, pot, rend, limitado: isFinite(obc) && obc < potRede, mono };
  }
  function draw() {
    if (!el || !el.isConnected) return;
    const d = dados();
    let res = '';
    if (s.modo === 'horas') {
      const kwh = num(s.km) * d.cons / 100, horas = kwh / (d.pot * d.rend);
      res = '<p class="vve-res">Para <b>' + f(num(s.km), 0) + ' km</b>: ' + f(kwh) + ' kWh na bateria → <b>' + hm(horas) + '</b> de carga a ' + f(d.pot) + ' kW' + '</p>' +
        '<p class="vve-nota">Energia tirada da rede ≈ ' + f(kwh / d.rend) + ' kWh (rendimento ' + f(d.rend * 100, 0) + ' %).</p>';
    } else {
      const kwh = d.pot * num(s.horas) * d.rend, km = kwh / d.cons * 100;
      res = '<p class="vve-res">Em <b>' + hm(num(s.horas)) + '</b> a ' + f(d.pot) + ' kW: ' + f(kwh) + ' kWh na bateria → <b>≈ ' + f(km, 0) + ' km</b></p>' +
        '<p class="vve-nota">Cerca de ' + f(km / num(s.horas), 0) + ' km por hora de carga.</p>';
    }
    const foco = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    el.innerHTML = '<div class="vve"><p class="vve-seps"><button type="button" data-modo="horas" class="' + (s.modo === 'horas' ? 'on' : 'alt') + '">Quantas horas preciso?</button> ' +
      '<button type="button" data-modo="km" class="' + (s.modo === 'km' ? 'on' : 'alt') + '">Quantos km ganho?</button></p><div class="vve-g">' +
      (s.modo === 'horas' ? '<label class="vve-c"><span>Km a recuperar</span><input data-k="km" inputmode="decimal" value="' + h(s.km) + '"></label>'
        : '<label class="vve-c"><span>Horas de carga</span><input data-k="horas" inputmode="decimal" value="' + h(s.horas) + '"><small>Ex.: 8 = noite; 1,5 = 1 h 30 min</small></label>') +
      '<label class="vve-c"><span>Potência disponível</span><select data-k="pot">' + POT.map(([v, t]) => '<option value="' + v + '"' + (v === s.pot ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>' +
      (s.pot === 'outra' ? '<input data-k="potOutra" inputmode="decimal" placeholder="kW" value="' + h(s.potOutra) + '">' : '') + '</label>' +
      '<label class="vve-c"><span>Marca e modelo</span><select data-k="carro"><option value="">Não sei — consumo médio (' + MEDIO + ' kWh/100 km)</option>' +
      CARROS.map((c, i) => '<option value="' + i + '"' + (String(i) === s.carro ? ' selected' : '') + '>' + h(c[0] + ' ' + c[1]) + '</option>').join('') + '</select></label>' +
      '<label class="vve-c"><span>Consumo (kWh/100 km)</span><input data-k="cons" inputmode="decimal" placeholder="' + f(d.c ? d.c[2] : MEDIO) + '" value="' + h(s.cons) + '"><small>Vazio = o do modelo (ou o médio)</small></label>' +
      '<label class="vve-c"><span>Carregador de bordo do carro (kW)</span><input data-k="obc" inputmode="decimal" placeholder="' + (d.c ? f(d.mono ? d.c[4] : d.c[3]) : 'sem limite') + '" value="' + h(s.obc) + '"><small>' + (d.mono ? 'Em monofásico' : 'Em trifásico') + '; vazio = o do modelo</small></label>' +
      '<label class="vve-c"><span>Rendimento da carga (%)</span><input data-k="rend" inputmode="decimal" value="' + h(s.rend) + '"><small>Perdas no carregador e na bateria: 85–92 %</small></label>' +
      '</div>' + res +
      (d.limitado ? '<p class="vve-aviso">⚠ O ' + h(d.c ? d.c[0] + ' ' + d.c[1] : 'carro') + ' só aceita ' + f(d.obc) + ' kW ' + (d.mono ? 'em monofásico' : 'em AC') + ': a potência disponível (' + f(d.potRede) + ' kW) não é toda aproveitada.</p>' : '') +
      '<p class="vve-nota">Valores típicos: o consumo real varia com a velocidade, o frio, o ar condicionado e o tipo de condução. A carga abranda acima dos 80 % de bateria. Confirme o carregador de bordo na ficha do carro.</p></div>' +
      '<style>.vve-seps button.on{background:#2346d6;color:#fff}.vve-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px 14px;margin:8px 0}.vve-c{display:flex;flex-direction:column;gap:3px;font-size:13px}.vve-c>span{font-weight:600}.vve-c small{font-size:11px;color:#5b6b75}.vve-c input,.vve-c select{padding:6px;font-size:14px}' +
      '.vve-res{font-size:17px;background:#eef6ee;border:1px solid #b8dab8;border-radius:8px;padding:8px 12px}.vve-aviso{background:#fff4d6;border:1px solid #e3c46b;border-radius:6px;padding:6px 10px;font-size:13px}.vve-nota{font-size:12px;color:#4a6371}</style>';
    if (foco) { const x = el.querySelector('[data-k="' + foco + '"]'); if (x) { x.focus(); try { const n = x.value.length; x.setSelectionRange(n, n); } catch (_) { } } }
  }
  function ligar(container) {
    el = container;
    el.addEventListener('click', ev => { const b = ev.target.closest('[data-modo]'); if (b) { s.modo = b.dataset.modo; draw(); } });
    const muda = ev => {
      const x = ev.target.closest('[data-k]'); if (!x) return;
      s[x.dataset.k] = x.value;
      if (x.dataset.k === 'carro') { s.cons = ''; s.obc = ''; }
      if (x.tagName === 'SELECT' || ev.type === 'change') draw(); else { clearTimeout(ligar._t); ligar._t = setTimeout(draw, 350); }
    };
    el.addEventListener('input', muda); el.addEventListener('change', muda);
    draw();
  }
  window.VolticCarregamento = { ligar, CARROS, MEDIO };
  if (window.VolticModulos) VolticModulos.registar({ id: ID, titulo: 'Carregamento de carros elétricos', descricao: 'Horas de carga para os km pretendidos, ou km ganhos com uma potência e um tempo; consumo médio se não souber o modelo.', abrir(c) { ligar(c); } });
})();

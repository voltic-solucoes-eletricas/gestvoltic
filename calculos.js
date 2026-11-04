/* Módulo «Cálculos elétricos» (separador Ferramentas, v146). Pedido do Jorge (04/11/2026):
   corrente, dimensionamento de condutores, intensidade admissível (vários tipos de condutores), barramentos e proteção.
   Norma: RTIEBT (Portugal, base IEC/HD 60364) — quadros do Anexo III em rtiebt.js. Disjuntores: IEC/EN 60898-1 (Icn) e
   IEC/EN 60947-2 (Icu/Ics) — nunca se misturam. Fusíveis gG: IEC/EN 60269. Só calcula; não grava nada nos dados.
   Feito para funcionar também sozinho (telemóvel/tablet): só precisa de window.VolticRTIEBT. */
(() => {
  'use strict';
  const ID = 'calculos-eletricos';
  const R = () => window.VolticRTIEBT;
  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) ? x : NaN; };
  const f = (x, d = 1) => isFinite(x) ? x.toLocaleString('pt-PT', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const f0 = x => f(x, 0);
  const fS = S => f(S, S % 1 ? 1 : 0);
  const IN_STD = [2, 4, 6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600];
  const U0 = 230, UL = 400;
  let el = null, sep = 'corrente';
  const est = { // valores do formulário (ficam enquanto o programa estiver aberto)
    corrente: { sis: 'mono', P: '3,68', un: 'kW', cos: '1', eta: '1', ku: '1', I: '' },
    cond: { Ib: '16', sis: 'mono', mat: 'cu', iso: 'pvc', met: 'B1', disp: '', temp: '30', tsolo: '20', n: '1', resist: '1', tubo: '0', L: '25', cos: '1',
            alim: 'A', uso: 'outros', prot: '60898', mono: 'Ft' },
    iz: { mat: 'cu', iso: 'pvc', car: '2', met: 'B1', temp: '30', k2: '1' },
    barr: { I: '400', mat: 'cu', theta: '40', ra: '1', esp: '' },
    prot: { Ib: '16', Iz: '24', tipo: '60898', curva: 'C', icc: '6' }
  };

  /* ---------------------------------------------------------- cálculos */
  const loaded = sis => sis === 'tri' ? 3 : 2;
  function corrente(P_W, sis, cos, eta) { return sis === 'tri' ? P_W / (Math.sqrt(3) * UL * cos * eta) : P_W / (U0 * cos * eta); }
  function potencia(I, sis, cos, eta) { return sis === 'tri' ? Math.sqrt(3) * UL * I * cos * eta : U0 * I * cos * eta; }
  function kTemp(iso, t, solo) {
    const T = solo ? R().D2 : R().D1, i = T.t.indexOf(+t);
    if (i < 0) return NaN;
    return T[iso][i] ?? NaN;
  }
  function kAgrup(met, disp, n) {
    n = Math.max(1, Math.round(n || 1));
    if (met === 'D') { let k = 1; for (const [m, v] of R().E2) if (n >= m) k = v; return k; }
    const row = R().E1[disp || dispDefeito(met)], ns = R().E1n;
    let i = ns.findIndex(x => x >= n); if (i < 0) i = ns.length - 1;   // entre colunas: usa a seguinte (mais desfavorável)
    return row.f[Math.min(i, row.f.length - 1)];
  }
  function dispDefeito(met) { return met === 'C' ? '2' : (met === 'E' || met.startsWith('F') || met.startsWith('G')) ? '4' : '1'; }
  function kSolo(r) { let k = 1, best = Infinity; for (const [x, v] of R().E6) { const d = Math.abs(x - r); if (d < best) { best = d; k = v; } } return k; }
  function chave(met, car, mono) {
    if (met === 'F') return car === 2 ? 'F' : (mono || 'Ft');
    if (met === 'G') return mono === 'Gv' ? 'Gv' : 'Gh';
    return met;
  }
  function tabela(mat, iso, car, met, mono) {
    const k = chave(met, car, mono), t = R()[mat]?.[iso]?.[car]?.[k];
    return t ? { k, v: t, S: R().S[mat], q: R().QUADRO[iso][car][k] || '' } : null;
  }
  function dU(Ib, L, S, mat, sis, cos) { // queda de tensão em % de U0 (mono: ida e volta)
    const rho = mat === 'al' ? 0.036 : 0.0225, lam = 0.00008, sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    const b = sis === 'tri' ? 1 : 2;
    return 100 * b * (rho * L / S * cos + lam * L * sin) * Ib / U0;
  }
  function I2(tipo, In) { if (tipo === 'gG') return (In <= 4 ? 2.1 : In < 16 ? 1.9 : 1.6) * In; return (tipo === '60947' ? 1.3 : 1.45) * In; }
  function inMinimo(Ib, tipo) { return IN_STD.find(x => x >= Ib && (tipo !== '60898' || x <= 125)); }

  /* ---------------------------------------------------------- desenho */
  const sel = (nome, val, ops) => '<select data-k="' + nome + '">' + ops.map(([v, t]) => '<option value="' + h(v) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + h(t) + '</option>').join('') + '</select>';
  const inp = (nome, val, extra = '') => '<input data-k="' + nome + '" value="' + h(val) + '" inputmode="decimal" ' + extra + '>';
  const campo = (rot, html, ajuda = '') => '<label class="vce-c"><span>' + rot + '</span>' + html + (ajuda ? '<small>' + ajuda + '</small>' : '') + '</label>';
  const METODOS = [
    ['A1', 'A1 — condutores isolados em tubo embebido em parede isolante'],
    ['A2', 'A2 — cabo multicondutor em tubo embebido em parede isolante'],
    ['B1', 'B1 — condutores isolados em tubo/calha à vista ou embebido em alvenaria'],
    ['B2', 'B2 — cabo multicondutor em tubo ou calha'],
    ['C', 'C — cabo fixado à parede ou em esteira não perfurada'],
    ['E', 'E — cabo multicondutor em esteira perfurada / escada'],
    ['F', 'F — cabos monocondutores em esteira perfurada (encostados)'],
    ['G', 'G — cabos monocondutores afastados (≥ diâmetro)'],
    ['D', 'D — enterrado (diretamente ou em tubo)']
  ];
  const TEMPS = R ? [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map(t => [t, t + ' ºC']) : [];

  function vCorrente() {
    const s = est.corrente, Pn = num(s.P) * (s.un === 'W' ? 1 : 1000), cos = num(s.cos), eta = num(s.eta) || 1, ku = num(s.ku) || 1;
    const Ib = corrente(Pn * ku, s.sis, cos, eta);
    const Iin = num(s.I), Pinv = potencia(Iin, s.sis, cos, eta);
    return '<div class="vce-g">' +
      campo('Sistema', sel('sis', s.sis, [['mono', 'Monofásico 230 V'], ['tri', 'Trifásico 400 V']])) +
      campo('Potência', inp('P', s.P) + sel('un', s.un, [['kW', 'kW'], ['W', 'W']])) +
      campo('cos φ', inp('cos', s.cos), '1 resistivo · 0,85–0,9 motores · 0,95 LED/eletrónica') +
      campo('Rendimento η', inp('eta', s.eta), 'Motores: 0,8–0,95; outros 1') +
      campo('Fator de utilização/simultaneidade', inp('ku', s.ku)) + '</div>' +
      '<p class="vce-res">Corrente de serviço I<sub>B</sub> = <b>' + f(Ib) + ' A</b>' +
      (s.sis === 'tri' ? ' <small>(I = P / (√3 × 400 × cos φ × η))</small>' : ' <small>(I = P / (230 × cos φ × η))</small>') + '</p>' +
      '<h4>Ao contrário: potência a partir da corrente</h4><div class="vce-g">' + campo('Corrente (A)', inp('I', s.I)) + '</div>' +
      (isFinite(Pinv) ? '<p class="vce-res">Potência = <b>' + f(Pinv / 1000, 2) + ' kW</b> (' + f(Pinv / 1000 / (cos || 1), 2) + ' kVA)</p>' : '');
  }

  function vCond() {
    const s = est.cond, mat = s.mat, iso = s.iso, car = loaded(s.sis), met = s.met, Ib = num(s.Ib), L = num(s.L), cos = num(s.cos) || 1;
    const solo = met === 'D', t = tabela(mat, iso, car, met, s.mono);
    const kt = kTemp(iso, solo ? s.tsolo : s.temp, solo), kg = kAgrup(met, s.disp, num(s.n)), ks = solo ? kSolo(num(s.resist)) : 1, ktubo = solo && s.tubo === '1' ? 0.8 : 1;
    const k = kt * kg * ks * ktubo;
    const lim = R().O[s.alim][s.uso];
    const In = inMinimo(Ib, s.prot);
    let linhas = '', escolha = null;
    if (t) t.S.forEach((S, i) => {
      const Iz0 = t.v[i]; if (Iz0 == null) return;
      const Iz = Iz0 * k, du = isFinite(L) ? dU(Ib, L, S, mat, s.sis, cos) : NaN;
      const okT = In && Iz >= In && I2(s.prot, In) <= 1.45 * Iz, okU = !isFinite(du) || du <= lim;
      if (!escolha && okT && okU && S >= (mat === 'al' ? 16 : 1.5)) escolha = { S, Iz, du };
      linhas += '<tr class="' + (escolha && escolha.S === S ? 'vce-ok' : '') + '"><td>' + fS(S) + ' mm²</td><td>' + f(Iz0, Iz0 % 1 ? 1 : 0) + '</td><td>' + f(Iz) + '</td><td class="' + (okT ? '' : 'vce-mau') + '">' + (okT ? '✔' : '✖') + '</td><td class="' + (okU ? '' : 'vce-mau') + '">' + f(du, 2) + ' %</td></tr>';
    });
    const ops = [...METODOS];
    return '<div class="vce-g">' +
      campo('Corrente de serviço I<sub>B</sub> (A)', inp('Ib', s.Ib), 'Calcule no separador «Corrente»') +
      campo('Sistema', sel('sis', s.sis, [['mono', 'Monofásico (2 condutores carregados)'], ['tri', 'Trifásico (3 condutores carregados)']])) +
      campo('Condutor', sel('mat', mat, [['cu', 'Cobre'], ['al', 'Alumínio (≥ 16 mm²)']])) +
      campo('Isolamento', sel('iso', iso, [['pvc', 'PVC (70 ºC) — ex.: H07V, VV'], ['xlpe', 'XLPE/EPR (90 ºC) — ex.: XV, XZ1']])) +
      campo('Modo de instalação (quadro 52H)', sel('met', met, ops)) +
      (met === 'F' && car === 3 ? campo('Disposição', sel('mono', s.mono, [['Ft', 'Em triângulo'], ['Fe', 'Em esteira, encostados']])) : '') +
      (met === 'G' ? campo('Afastamento', sel('mono', s.mono === 'Gv' ? 'Gv' : 'Gh', [['Gh', 'Na horizontal'], ['Gv', 'Na vertical']])) : '') +
      (solo ? campo('Temperatura do solo', sel('tsolo', s.tsolo, TEMPS), 'Referência 20 ºC (52-D2)') + campo('Resistividade térmica do solo (K·m/W)', sel('resist', s.resist, R().E6.map(([x]) => [x, f(x, 2)])), '1 = terreno seco (52-E6)') + campo('Em tubo enterrado?', sel('tubo', s.tubo, [['0', 'Não (diretamente no solo)'], ['1', 'Sim (× 0,8)']]))
        : campo('Temperatura ambiente', sel('temp', s.temp, TEMPS), 'Referência 30 ºC (52-D1)')) +
      campo(solo ? 'N.º de cabos lado a lado (≥ 0,2 m)' : 'N.º de circuitos agrupados', inp('n', s.n), solo ? '52-E2' : '52-E1') +
      (!solo ? campo('Disposição do agrupamento', sel('disp', s.disp || dispDefeito(met), Object.entries(R().E1).map(([k, v]) => [k, v.nome]))) : '') +
      campo('Comprimento (m)', inp('L', s.L)) + campo('cos φ', inp('cos', s.cos)) +
      campo('Alimentação', sel('alim', s.alim, Object.entries(R().O).map(([k, v]) => [k, v.nome]))) +
      campo('Utilização', sel('uso', s.uso, [['outros', 'Outros usos'], ['ilum', 'Iluminação']]), 'Queda máx. ' + lim + ' % (52-O)') +
      campo('Proteção', sel('prot', s.prot, [['60898', 'Disjuntor IEC/EN 60898-1 (I₂ = 1,45 In)'], ['60947', 'Disjuntor IEC/EN 60947-2 (I₂ = 1,30 In)'], ['gG', 'Fusível gG IEC/EN 60269']])) +
      '</div>' +
      (!t ? '<p class="vce-mau">Este modo de instalação não tem valores no RTIEBT para esta combinação.</p>' :
        '<p class="vce-res">' + (escolha ? 'Secção mínima: <b>' + fS(escolha.S) + ' mm²</b> · proteção <b>' + In + ' A</b> · I<sub>z</sub> corrigida ' + f(escolha.Iz) + ' A · queda ' + f(escolha.du, 2) + ' %'
          : '<span class="vce-mau">Nenhuma secção do quadro cumpre — reveja os dados (corrente, comprimento ou modo de instalação) ou use condutores em paralelo.</span>') + '</p>' +
        '<p class="vce-nota">Fatores: temperatura ' + f(kt, 2) + ' × agrupamento ' + f(kg, 2) + (solo ? ' × solo ' + f(ks, 2) + (ktubo !== 1 ? ' × tubo 0,8' : '') : '') + ' = <b>' + f(k, 3) + '</b> · Quadro ' + h(t.q) +
        ' · Condição 433.2: I<sub>B</sub> ≤ I<sub>n</sub> ≤ I<sub>z</sub> e I<sub>2</sub> ≤ 1,45 I<sub>z</sub>' + (s.prot === 'gG' && In ? ' (gG: I₂ = ' + f(I2('gG', In) / In, 1) + ' In)' : '') + '.</p>' +
        '<table class="vce-t"><thead><tr><th>Secção</th><th>I<sub>z</sub> quadro (A)</th><th>I<sub>z</sub> corrigida (A)</th><th>Proteção ' + (In || '—') + ' A</th><th>Queda de tensão</th></tr></thead><tbody>' + linhas + '</tbody></table>' +
        '<p class="vce-nota">Queda de tensão: ΔU = b (ρ₁ L/S cos φ + λ L sin φ) I<sub>B</sub>, com ρ₁ = ' + (mat === 'al' ? '0,036' : '0,0225') + ' Ω·mm²/m (condutor em serviço), λ = 0,08 mΩ/m, b = ' + (car === 2 ? '2 (monofásico)' : '1 (trifásico)') +
        ', em % de 230 V. Neutro e proteção: 524.2 / 543 do RTIEBT. Confirme sempre o cabo escolhido no catálogo do fabricante.</p>');
  }

  function vIz() {
    const s = est.iz, car = +s.car, t = tabela(s.mat, s.iso, car, s.met, s.mono), solo = s.met === 'D';
    const kt = kTemp(s.iso, s.temp, solo), k2 = num(s.k2) || 1, k = kt * k2;
    return '<div class="vce-g">' +
      campo('Condutor', sel('mat', s.mat, [['cu', 'Cobre'], ['al', 'Alumínio (≥ 16 mm²)']])) +
      campo('Isolamento', sel('iso', s.iso, [['pvc', 'PVC (70 ºC)'], ['xlpe', 'XLPE/EPR (90 ºC)']])) +
      campo('Condutores carregados', sel('car', s.car, [['2', '2 (monofásico)'], ['3', '3 (trifásico)']])) +
      campo('Modo de instalação', sel('met', s.met, METODOS)) +
      (s.met === 'F' && car === 3 ? campo('Disposição', sel('mono', s.mono || 'Ft', [['Ft', 'Em triângulo'], ['Fe', 'Em esteira, encostados']])) : '') +
      (s.met === 'G' ? campo('Afastamento', sel('mono', s.mono === 'Gv' ? 'Gv' : 'Gh', [['Gh', 'Na horizontal'], ['Gv', 'Na vertical']])) : '') +
      campo(solo ? 'Temperatura do solo' : 'Temperatura ambiente', sel('temp', s.temp, TEMPS)) +
      campo('Outro fator (agrupamento…)', inp('k2', s.k2)) + '</div>' +
      (!t ? '<p class="vce-mau">Sem valores no RTIEBT para esta combinação.</p>' :
        '<p class="vce-nota">Quadro ' + h(t.q) + ' · fator total ' + f(k, 3) + '</p><table class="vce-t"><thead><tr><th>Secção</th><th>I<sub>z</sub> quadro (A)</th><th>I<sub>z</sub> × fator (A)</th></tr></thead><tbody>' +
        t.S.map((S, i) => t.v[i] == null ? '' : '<tr><td>' + fS(S) + ' mm²</td><td>' + f(t.v[i], t.v[i] % 1 ? 1 : 0) + '</td><td>' + f(t.v[i] * k) + '</td></tr>').join('') + '</tbody></table>') +
      '<details><summary>Notas do RTIEBT e gralhas do PDF</summary><ul class="vce-nota"><li>Ar: 30 ºC de referência; enterrado: 20 ºC e 1 K·m/W.</li><li>Cabos enterrados em tubo: × 0,8 (nota do quadro 52-C30).</li>' +
      R().GRALHAS.map(g => '<li>' + h(g) + '</li>').join('') + '</ul></details>';
  }

  // Barramento — fórmula dos apontamentos do Jorge (CET 5127): I = 24,9·S^0,5·p^0,39·θ^0,61 / √(ρ[1+α(θ+25)]) · 1/√(Ra/Rc) · 1/√(1 − 0,015(θ+25)/10)
  const BARRAS = [[12, 2], [12, 5], [15, 5], [20, 5], [20, 10], [25, 5], [30, 5], [30, 10], [40, 5], [40, 10], [50, 5], [50, 10], [60, 10], [80, 10], [100, 10], [120, 10]];
  function iBarra(lmm, emm, mat, theta, ra) {
    const S = lmm * emm / 100, p = 2 * (lmm + emm) / 10;
    const rho = mat === 'al' ? 2.9 : 1.83, alfa = mat === 'al' ? 0.004 : 0.004;
    const termo = 1 - 0.015 * (theta + 25) / 10;
    return 24.9 * Math.pow(S, 0.5) * Math.pow(p, 0.39) * Math.pow(theta, 0.61) / Math.sqrt(rho * (1 + alfa * (theta + 25))) / Math.sqrt(ra || 1) / Math.sqrt(termo > 0 ? termo : 1);
  }
  function vBarr() {
    const s = est.barr, I = num(s.I), th = num(s.theta), ra = num(s.ra) || 1;
    const lista = BARRAS.map(([l, e]) => ({ l, e, I: iBarra(l, e, s.mat, th, ra) }));
    const esc = lista.filter(x => x.I >= I).sort((a, b) => a.l * a.e - b.l * b.e || a.I - b.I)[0];   // a de menor secção que chega
    return '<div class="vce-g">' + campo('Corrente a transportar (A)', inp('I', s.I)) +
      campo('Material', sel('mat', s.mat, [['cu', 'Cobre'], ['al', 'Alumínio']])) +
      campo('Sobreaquecimento θ (K) acima de 45 ºC', inp('theta', s.theta), 'Ex.: 40 K → barra a 85 ºC') +
      campo('Efeito pelicular Ra/Rc', inp('ra', s.ra), '1 = desprezável; barras largas ≈ 1,02–1,10') + '</div>' +
      '<p class="vce-res">' + (esc ? 'Barra mínima (1 por fase): <b>' + esc.l + ' × ' + esc.e + ' mm</b> — cerca de ' + f0(esc.I) + ' A' : '<span class="vce-mau">Acima de 120 × 10 mm: use várias barras por fase e confirme no fabricante.</span>') + '</p>' +
      '<table class="vce-t"><thead><tr><th>Barra (mm)</th><th>Secção</th><th>Corrente estimada</th></tr></thead><tbody>' +
      lista.map(x => '<tr class="' + (esc && x === esc ? 'vce-ok' : '') + '"><td>' + x.l + ' × ' + x.e + '</td><td>' + (x.l * x.e) + ' mm²</td><td>' + f0(x.I) + ' A</td></tr>').join('') + '</tbody></table>' +
      '<p class="vce-nota">Estimativa pela fórmula dos seus apontamentos do CET (5127, «Capacidade de transporte de corrente do barramento»), com ρ a 20 ºC em µΩ·cm (cobre 1,83; alumínio 2,9) e α = 0,004. ' +
      'Uma barra por fase, nua, na vertical. Não é um quadro do RTIEBT: para o quadro final confirme no catálogo do fabricante do barramento (Hager, Schneider, Rittal…), que dá a corrente para o seu suporte e invólucro.</p>';
  }

  function vProt() {
    const s = est.prot, Ib = num(s.Ib), Iz = num(s.Iz), tipo = s.tipo;
    const cands = IN_STD.filter(x => x >= Ib && x <= Iz && I2(tipo, x) <= 1.45 * Iz && (tipo !== '60898' || x <= 125));
    const In = cands[0], icc = num(s.icc);
    const ICN = [3, 4.5, 6, 10, 15, 20, 25];
    const curvas = { B: 'B (3–5 In): cargas resistivas, cabos longos, circuitos de tomadas domésticas', C: 'C (5–10 In): uso geral, iluminação, pequenos motores', D: 'D (10–20 In): motores com arranque pesado, transformadores' };
    return '<div class="vce-g">' + campo('Corrente de serviço I<sub>B</sub> (A)', inp('Ib', s.Ib)) +
      campo('Corrente admissível do cabo I<sub>z</sub> (A, já corrigida)', inp('Iz', s.Iz), 'Do separador «Condutores»') +
      campo('Dispositivo', sel('tipo', tipo, [['60898', 'Disjuntor IEC/EN 60898-1 (até 125 A) — poder de corte Icn'], ['60947', 'Disjuntor IEC/EN 60947-2 — poder de corte Icu/Ics'], ['gG', 'Fusível gG IEC/EN 60269']])) +
      (tipo !== 'gG' ? campo('Curva', sel('curva', s.curva, Object.keys(curvas).map(k => [k, curvas[k]]))) : '') +
      campo('Corrente de curto-circuito presumida no local (kA)', inp('icc', s.icc), 'Dada pela E-REDES / cálculo da instalação') + '</div>' +
      '<p class="vce-res">' + (In ? 'Calibre: <b>' + In + ' A</b>' + (cands.length > 1 ? ' (também servem: ' + cands.slice(1, 4).join(', ') + ' A)' : '') :
        '<span class="vce-mau">Nenhum calibre cumpre I<sub>B</sub> ≤ I<sub>n</sub> ≤ I<sub>z</sub> e I<sub>2</sub> ≤ 1,45 I<sub>z</sub>: aumente a secção do cabo.</span>') + '</p>' +
      (In ? '<ul class="vce-nota"><li>I<sub>B</sub> = ' + f(Ib) + ' ≤ I<sub>n</sub> = ' + In + ' ≤ I<sub>z</sub> = ' + f(Iz) + ' A ✔</li><li>I<sub>2</sub> = ' + f(I2(tipo, In)) + ' A ≤ 1,45 × I<sub>z</sub> = ' + f(1.45 * Iz) + ' A ✔ (RTIEBT 433.2)</li>' +
        (tipo === '60898' ? '<li>Poder de corte: <b>Icn ≥ ' + f(icc) + ' kA</b> (IEC/EN 60898-1). Valores correntes: ' + ICN.filter(x => x >= icc).slice(0, 3).map(x => f(x, x % 1 ? 1 : 0) + ' kA').join(', ') + '.</li>'
          : tipo === '60947' ? '<li>Poder de corte: <b>Icu ≥ ' + f(icc) + ' kA</b> (IEC/EN 60947-2); veja também Ics. Não confundir com o Icn da 60898-1.</li>'
            : '<li>Poder de corte do fusível gG (normalmente ≥ 50 kA) ≥ ' + f(icc) + ' kA.</li>') +
        '<li>Proteção diferencial e contactos indiretos: verifique à parte (RTIEBT 413).</li></ul>' : '');
  }

  const SEPS = [['corrente', 'Corrente'], ['cond', 'Dimensionar condutores'], ['iz', 'Intensidade admissível'], ['barr', 'Barramentos'], ['prot', 'Proteção']];
  function draw() {
    if (!el || !el.isConnected) return;
    if (!R()) { el.innerHTML = '<p class="warn">Faltam os quadros do RTIEBT (rtiebt.js).</p>'; return; }
    const corpo = { corrente: vCorrente, cond: vCond, iz: vIz, barr: vBarr, prot: vProt }[sep]();
    const foco = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    const pos = foco && document.activeElement.selectionStart;
    el.innerHTML = '<div class="vce"><p class="vce-seps">' + SEPS.map(([k, t]) => '<button type="button" data-sep="' + k + '" class="' + (k === sep ? 'on' : 'alt') + '">' + t + '</button>').join(' ') + '</p>' + corpo +
      '<p class="vce-nota vce-fim">Norma: RTIEBT (Portaria 949-A/2006, base IEC/HD 60364). Ferramenta de apoio ao cálculo: a responsabilidade do projeto é do técnico.</p></div>' + CSS;
    if (foco) { const x = el.querySelector('[data-k="' + foco + '"]'); if (x) { x.focus(); try { if (pos != null) x.setSelectionRange(pos, pos); } catch (_) { } } }
  }
  const CSS = '<style>.vce-seps button.on{background:#2346d6;color:#fff}.vce-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px 14px;margin:8px 0}' +
    '.vce-c{display:flex;flex-direction:column;font-size:13px;gap:3px}.vce-c>span{font-weight:600}.vce-c small{color:#5b6b75;font-size:11px}.vce-c select,.vce-c input{padding:6px;font-size:14px;max-width:100%}' +
    '.vce-c input+select{margin-top:4px}.vce-res{font-size:16px;background:#eef6ee;border:1px solid #b8dab8;border-radius:8px;padding:8px 12px}.vce-mau{color:#b3261e}' +
    '.vce-t{border-collapse:collapse;font-size:13px;margin:6px 0;min-width:320px}.vce-t th,.vce-t td{border-bottom:1px solid #dde5ea;padding:3px 10px;text-align:right}.vce-t th:first-child,.vce-t td:first-child{text-align:left}' +
    '.vce-t tr.vce-ok td{background:#e2f3e2;font-weight:700}.vce-nota{font-size:12px;color:#4a6371}.vce-fim{margin-top:14px;border-top:1px solid #e1e5ea;padding-top:6px}</style>';

  function ligar(container) {
    el = container;
    el.addEventListener('click', ev => { const b = ev.target.closest('[data-sep]'); if (b) { sep = b.dataset.sep; draw(); } });
    const muda = ev => {
      const x = ev.target.closest('[data-k]'); if (!x) return;
      est[sep][x.dataset.k] = x.value;
      if (sep === 'cond' && x.dataset.k === 'met') est.cond.disp = '';
      if (ev.type === 'change' || x.tagName === 'SELECT') draw(); else { clearTimeout(ligar._t); ligar._t = setTimeout(draw, 350); }
    };
    el.addEventListener('input', muda); el.addEventListener('change', muda);
    draw();
  }
  window.VolticCalculos = { ligar, iBarra, dU, corrente, tabela };   // para o telemóvel/tablet e testes
  if (window.VolticModulos) VolticModulos.registar({ id: ID, titulo: 'Cálculos elétricos', descricao: 'Corrente, dimensionamento de condutores (RTIEBT), intensidade admissível, barramentos e proteção.', abrir(c) { ligar(c); } });
})();

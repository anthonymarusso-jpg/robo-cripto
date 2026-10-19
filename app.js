(function () {
  "use strict";

  const HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
  const MS = { "1h": 3600000, "4h": 14400000, "1d": 86400000 };
  const CFG = Motor.PADRAO;
  const AQUEC = CFG.emaFiltro + 60;            // candles de aquecimento dos indicadores
  const $ = id => document.getElementById(id);

  // ------------------------------------------------------------- armazenamento local
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* idem */ } },
  };

  const S = {
    par: store.get("par", "BTCUSDT"), tf: store.get("tf", "4h"), aba: store.get("aba", "sinal"),
    dias: store.get("dias", 365), k: null, fech: null, ind: null, preco: null, var24: null,
    carteiraCache: null, carregando: false,
  };

  // ------------------------------------------------------------- formatação
  const nf = (min, max) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });
  function fp(v) {
    if (v == null || !isFinite(v)) return "—";
    const a = Math.abs(v);
    return a >= 100 ? nf(2, 2).format(v) : a >= 1 ? nf(2, 4).format(v) : nf(4, 6).format(v);
  }
  const fe = v => Math.abs(v) >= 1000 ? nf(0, 0).format(v) : fp(v);   // rótulo de eixo
  const fu = v => (v == null || !isFinite(v)) ? "—" : nf(2, 2).format(v);
  const fpct = (x, d = 2) => (x == null || !isFinite(x)) ? "—" : (x > 0 ? "+" : "") + nf(d, d).format(x * 100) + "%";
  const fdata = t => new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const fdia = t => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const fhora = t => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const nomePar = p => p.replace("USDT", "/USDT");
  const cls = x => x > 0 ? "pos" : x < 0 ? "neg" : "";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function duracao(ms) {
    if (ms <= 0) return "agora";
    const m = Math.round(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 1) return `${d}d ${h % 24}h`;
    if (h >= 1) return `${h}h ${String(m % 60).padStart(2, "0")}min`;
    return `${m} min`;
  }

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast"; el.textContent = msg; el.setAttribute("role", "status");
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // ------------------------------------------------------------- dados da Binance
  async function api(caminho) {
    let erro;
    for (const h of HOSTS) {
      try {
        const r = await fetch(h + caminho, { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } catch (e) { erro = e; }
    }
    throw erro;
  }
  const parse = rows => rows.map(r => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5], fim: r[6] }));
  const soFechados = k => k.filter(x => x.fim < Date.now());

  async function klinesRecentes(par, tf, n = 500) {
    return parse(await api(`/api/v3/klines?symbol=${par}&interval=${tf}&limit=${n}`));
  }
  async function klinesDesde(par, tf, inicio, aoProgredir) {
    let out = [], desde = inicio;
    const agora = Date.now();
    while (desde < agora) {
      const lote = parse(await api(`/api/v3/klines?symbol=${par}&interval=${tf}&startTime=${desde}&limit=1000`));
      if (!lote.length) break;
      out = out.concat(lote);
      const novo = lote[lote.length - 1].t + MS[tf];
      if (novo <= desde) break;
      desde = novo;
      if (aoProgredir) aoProgredir(out.length);
      if (lote.length < 1000) break;
    }
    const vistos = new Set();
    return out.filter(x => !vistos.has(x.t) && vistos.add(x.t));
  }

  // ------------------------------------------------------------- gráficos (canvas)
  function cor(nome) { return getComputedStyle(document.documentElement).getPropertyValue(nome).trim(); }

  function prepararCanvas(cv, alturaCss) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 320;
    cv.style.height = alturaCss + "px";
    cv.width = Math.round(w * dpr); cv.height = Math.round(alturaCss * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h: alturaCss };
  }

  function eixoY(ctx, w, h, min, max, padR, padT, padB, fmt) {
    ctx.font = "11px " + cor("--font-num");
    ctx.fillStyle = cor("--muted"); ctx.strokeStyle = cor("--line"); ctx.lineWidth = 1;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (let j = 0; j <= 3; j++) {
      const v = min + (max - min) * j / 3;
      const y = padT + (h - padT - padB) * (1 - j / 3);
      ctx.beginPath(); ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(w - padR, Math.round(y) + .5); ctx.stroke();
      ctx.fillText(fmt(v), w - padR + 6, y);
    }
  }

  function desenharVelas(cv, k, ind, nFech) {
    const { ctx, w, h } = prepararCanvas(cv, 260);
    ctx.clearRect(0, 0, w, h);
    const N = Math.min(90, k.length), ini = k.length - N;
    const vis = k.slice(ini);
    const padT = 10, padB = 22;
    let min = Infinity, max = -Infinity;
    vis.forEach((x, j) => {
      const i = ini + j;
      min = Math.min(min, x.l); max = Math.max(max, x.h);
      if (i < nFech) [ind.emaRapida[i], ind.emaLenta[i], ind.emaFiltro[i]].forEach(v => { if (isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); } });
    });
    const m = (max - min) * 0.06; min -= m; max += m;
    ctx.font = "600 11px " + cor("--font-num");
    const padR = Math.ceil(Math.max(ctx.measureText(fe(max)).width, ctx.measureText(fe(vis[N - 1].c)).width)) + 14;
    const Y = v => padT + (h - padT - padB) * (1 - (v - min) / (max - min));
    const passo = (w - padR) / N, X = j => passo * j + passo / 2;
    eixoY(ctx, w, h, min, max, padR, padT, padB, fe);

    // datas
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = cor("--muted");
    [0.15, 0.5, 0.85].forEach(f => { const j = Math.floor(f * (N - 1)); ctx.fillText(fdia(vis[j].t), X(j), h - 6); });

    const up = cor("--up"), down = cor("--down");
    const larg = Math.max(1, passo * 0.62);
    vis.forEach((x, j) => {
      const c = x.c >= x.o ? up : down;
      ctx.strokeStyle = c; ctx.fillStyle = c; ctx.globalAlpha = (ini + j) >= nFech ? 0.45 : 1;
      ctx.beginPath(); ctx.moveTo(X(j), Y(x.h)); ctx.lineTo(X(j), Y(x.l)); ctx.stroke();
      const y1 = Y(Math.max(x.o, x.c)), y2 = Y(Math.min(x.o, x.c));
      ctx.fillRect(X(j) - larg / 2, y1, larg, Math.max(1, y2 - y1));
    });
    ctx.globalAlpha = 1;

    const linha = (arr, c, tracejado, esp) => {
      ctx.strokeStyle = c; ctx.lineWidth = esp; ctx.setLineDash(tracejado ? [5, 4] : []);
      ctx.beginPath(); let iniciou = false;
      for (let j = 0; j < N; j++) {
        const i = ini + j; if (i >= nFech || !isFinite(arr[i])) continue;
        if (!iniciou) { ctx.moveTo(X(j), Y(arr[i])); iniciou = true; } else ctx.lineTo(X(j), Y(arr[i]));
      }
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    };
    linha(ind.emaFiltro, cor("--muted"), true, 1.4);
    linha(ind.emaLenta, cor("--warn"), false, 1.6);
    linha(ind.emaRapida, cor("--accent"), false, 1.6);

    ctx.font = "bold 12px " + cor("--font-ui"); ctx.textAlign = "center";
    for (let j = 0; j < N; j++) {
      const i = ini + j; if (i >= nFech) continue;
      if (ind.sinal[i] === Motor.COMPRA) { ctx.fillStyle = up; ctx.fillText("▲", X(j), Y(k[i].l) + 14); }
      if (ind.sinal[i] === Motor.VENDA) { ctx.fillStyle = down; ctx.fillText("▼", X(j), Y(k[i].h) - 5); }
    }
    // preço atual
    const u = k[k.length - 1], yu = Y(u.c);
    ctx.fillStyle = cor("--accent"); ctx.fillRect(w - padR + 1, yu - 9, padR - 1, 18);
    ctx.fillStyle = cor("--accent-fg"); ctx.font = "600 11px " + cor("--font-num"); ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(fe(u.c), w - padR + 5, yu);
  }

  function desenharLinhas(cv, series, altura) {
    const { ctx, w, h } = prepararCanvas(cv, altura || 190);
    ctx.clearRect(0, 0, w, h);
    const todos = series.flatMap(s => s.pts.map(p => p.v));
    if (!todos.length) return;
    let min = Math.min(...todos), max = Math.max(...todos);
    if (min === max) { min -= 1; max += 1; }
    const m = (max - min) * 0.08; max += m; min = Math.min(...todos) >= 0 ? Math.max(0, min - m) : min - m;
    const padR = 58, padT = 8, padB = 20;
    const t0 = series[0].pts[0].t, t1 = series[0].pts[series[0].pts.length - 1].t;
    const X = t => (w - padR) * (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0));
    const Y = v => padT + (h - padT - padB) * (1 - (v - min) / (max - min));
    eixoY(ctx, w, h, min, max, padR, padT, padB, v => nf(0, 0).format(v));
    ctx.fillStyle = cor("--muted"); ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText(fdia(t0), 34, h - 5); ctx.fillText(fdia(t1), w - padR - 34, h - 5);
    series.forEach(s => {
      ctx.strokeStyle = s.cor; ctx.lineWidth = s.esp || 2; ctx.setLineDash(s.tracejado ? [5, 4] : []);
      ctx.beginPath();
      s.pts.forEach((p, i) => i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v)));
      ctx.stroke(); ctx.setLineDash([]);
    });
    const s0 = series[0], u = s0.pts[s0.pts.length - 1];
    ctx.fillStyle = s0.cor; ctx.beginPath(); ctx.arc(X(u.t), Y(u.v), 3.5, 0, Math.PI * 2); ctx.fill();
  }

  // ------------------------------------------------------------- aba SINAL
  function renderSinal() {
    const k = S.fech, ind = S.ind;
    if (!k || k.length < CFG.emaFiltro + 50) return;
    const i = k.length - 1, s = ind.sinal[i], e = ind.estado[i], r = ind.rsi[i];
    let tipo, pill, pillCls, titulo, texto;
    if (s === Motor.COMPRA) {
      tipo = "compra"; pill = "COMPRA"; pillCls = "up"; titulo = "Sinal de compra";
      texto = `O candle de ${fdata(k[i].t)} fechou com gatilho de compra. O robô compraria na abertura do candle atual.`;
    } else if (s === Motor.VENDA) {
      tipo = "venda"; pill = "VENDA"; pillCls = "down"; titulo = "Sinal de venda";
      texto = "A EMA 9 cruzou para baixo da EMA 21. Se estivesse comprado, o robô venderia na abertura do candle atual.";
    } else if (e.regime) {
      tipo = "tendencia"; pill = "TENDÊNCIA DE ALTA"; pillCls = "accent"; titulo = "Em tendência, aguardando gatilho";
      texto = "As condições de tendência estão verdes. O robô compra quando a EMA 9 cruzar a EMA 21 para cima ou quando o preço corrigir e voltar para cima da EMA 9.";
    } else {
      tipo = "fora"; pill = "FORA DO MERCADO"; pillCls = "warn"; titulo = "Sem tendência de alta";
      texto = "O robô não compra enquanto alguma condição abaixo estiver vermelha.";
    }
    $("cardEstado").className = "card estado " + tipo;
    const ep = $("estadoPill"); ep.className = "pill " + pillCls; ep.textContent = pill;
    $("estadoTitulo").textContent = titulo;
    let ultimo = -1;
    for (let j = i; j >= 0; j--) if (ind.sinal[j] !== 0) { ultimo = j; break; }
    const ult = ultimo >= 0 && ultimo !== i
      ? ` Último sinal: ${ind.sinal[ultimo] > 0 ? "compra" : "venda"} em ${fdata(k[ultimo].t)}.` : "";
    $("estadoTexto").textContent = texto + ult;

    const fecha = S.k[S.k.length - 1].fim + 1;
    $("proximo").textContent = `próximo candle fecha em ${duracao(fecha - Date.now())} (${fhora(fecha)})`;

    const itens = [
      ["EMA 9 acima da EMA 21", e.acima, `${fp(ind.emaRapida[i])} / ${fp(ind.emaLenta[i])}`],
      ["Preço acima da EMA 200", e.acimaFiltro, fp(ind.emaFiltro[i])],
      ["EMA 200 subindo", e.filtroSubindo, fpct(ind.emaFiltro[i] / ind.emaFiltro[i - 10] - 1)],
      ["RSI abaixo de 70", r < CFG.rsiMax, nf(1, 1).format(r)],
    ];
    $("checks").innerHTML = itens.map(([t, ok, v]) =>
      `<li class="${ok ? "sim" : "nao"}"><span class="ic" aria-label="${ok ? "sim" : "não"}">${ok ? "✓" : "✕"}</span><span>${t}</span><span class="v num">${v}</span></li>`).join("");

    const preco = S.preco || k[i].c, a = ind.atr[i];
    const stop = preco - CFG.stopAtr * a, alvo = preco + CFG.alvoAtr * a;
    const pxe = preco * (1 + CFG.slippage);
    const qtd = Math.min(CFG.capital * CFG.risco / Math.max(pxe - stop, pxe * 0.002), CFG.capital * CFG.exposicao / (pxe * (1 + CFG.taxa)));
    $("niveis").innerHTML = [
      ["Preço", fp(preco)], ["ATR (volatilidade)", fp(a)],
      ["Stop loss", `<span class="neg">${fp(stop)}</span>`], ["Alvo", `<span class="pos">${fp(alvo)}</span>`],
      ["Distância do stop", fpct(stop / preco - 1)], ["Posição com 1.000 USDT", fu(qtd * pxe) + " USDT"],
    ].map(([a1, b]) => `<div class="kpi"><span>${a1}</span><b>${b}</b></div>`).join("");

    desenharVelas($("grafico"), S.k, ind, k.length);

    // aviso de novo sinal
    const chave = `ultsinal_${S.par}_${S.tf}`, marca = k[i].t;
    if (s !== 0 && store.get(chave, 0) !== marca) {
      if (store.get(chave, null) !== null) toast(`Novo sinal de ${s > 0 ? "COMPRA" : "VENDA"} em ${nomePar(S.par)} ${S.tf}`);
      store.set(chave, marca);
    } else if (store.get(chave, null) === null) store.set(chave, 0);
  }

  // ------------------------------------------------------------- aba CARTEIRA
  const chaveCart = () => `carteira_${S.par}_${S.tf}`;

  function renderCarteiraVazia() {
    $("carteiraConteudo").innerHTML = `
      <div class="card">
        <h2>Carteira simulada · ${nomePar(S.par)} ${S.tf}</h2>
        <h3>Teste a estratégia daqui para frente, sem dinheiro real</h3>
        <p>Você começa com 1.000 USDT de mentira. A partir de agora, o robô compra e vende sozinho seguindo os sinais, com taxa e slippage. Como tudo é recalculado com os candles reais desde o início, a carteira fica em dia mesmo com o app fechado.</p>
        <p>Cada par e tempo gráfico tem a sua própria carteira.</p>
        <button class="btn" id="iniciarCart">Iniciar com 1.000 USDT simulados</button>
      </div>`;
    $("iniciarCart").onclick = () => {
      store.set(chaveCart(), { inicio: Date.now(), capital: CFG.capital });
      S.carteiraCache = null;
      toast("Carteira simulada iniciada");
      atualizarCarteira(true);
    };
  }

  async function atualizarCarteira(forcar) {
    const cart = store.get(chaveCart(), null);
    if (!cart) { renderCarteiraVazia(); return; }
    const ck = `${chaveCart()}_${cart.inicio}`;
    const c = S.carteiraCache;
    if (!forcar && c && c.chave === ck && Date.now() - c.quando < 60000) { renderCarteira(cart, c.res, c.fech, c.ini); return; }
    if (!c || c.chave !== ck) $("carteiraConteudo").innerHTML = `<div class="card"><p class="esqueleto">Recalculando a carteira com os candles reais desde ${fdata(cart.inicio)}…</p></div>`;
    try {
      const k = await klinesDesde(S.par, S.tf, cart.inicio - AQUEC * MS[S.tf]);
      const fech = soFechados(k);
      let idx = fech.findIndex(x => x.t >= cart.inicio);
      if (idx < 0) idx = fech.length;
      const ini = idx + 1;
      const res = fech.length > ini ? Motor.rodar(fech, { capital: cart.capital }, { inicio: ini, fecharNoFim: false }) : null;
      S.carteiraCache = { chave: ck, quando: Date.now(), res, fech, ini };
      renderCarteira(cart, res, fech, ini);
    } catch (e) {
      $("carteiraConteudo").innerHTML = `<div class="erro-box">Não consegui buscar os candles da Binance (${esc(e.message)}). Confira a internet e toque em Carteira de novo.</div>`;
    }
  }

  function renderCarteira(cart, res, fech, ini) {
    const preco = S.preco || (fech.length ? fech[fech.length - 1].c : 0);
    const w = res ? res.carteira : { caixa: cart.capital, qtd: 0, ops: [], custos: 0 };
    const patr = w.caixa + w.qtd * preco;
    const result = patr / cart.capital - 1;
    const base = preco && fech[ini - 1] ? preco / fech[ini - 1].o - 1 : null;
    const dias = Math.max(0, (Date.now() - cart.inicio) / 86400000);
    let posicao;
    if (w.qtd > 0) {
      const aberto = (preco * (1 - CFG.slippage) * (1 - CFG.taxa) * w.qtd) - w.custoEntrada;
      posicao = `<div class="card">
        <h2>Posição aberta</h2>
        <div class="linha"><span class="pill up">COMPRADO</span><span class="meta">desde ${fdata(w.entradaT)}</span></div>
        <div class="grade">
          <div class="kpi"><span>Quantidade</span><b>${nf(4, 6).format(w.qtd)}</b></div>
          <div class="kpi"><span>Preço de entrada</span><b>${fp(w.entrada)}</b></div>
          <div class="kpi"><span>Stop (móvel)</span><b class="neg">${fp(w.stop)}</b></div>
          <div class="kpi"><span>Alvo</span><b class="pos">${w.alvo ? fp(w.alvo) : "—"}</b></div>
          <div class="kpi"><span>Resultado se vender agora</span><b class="${cls(aberto)}">${fu(aberto)} USDT</b></div>
          <div class="kpi"><span>Distância do stop</span><b>${fpct(w.stop / preco - 1)}</b></div>
        </div></div>`;
    } else {
      const primeiro = Math.ceil(cart.inicio / MS[S.tf]) * MS[S.tf] + MS[S.tf];
      const prox = fech.length <= ini ? ` O primeiro sinal possível sai no fechamento do candle das ${fdata(primeiro)}.` : "";
      posicao = `<div class="card"><h2>Posição</h2><div class="linha"><span class="pill neutro">FORA DO MERCADO</span></div><p>O robô espera o próximo sinal de compra.${prox}</p></div>`;
    }
    const ops = w.ops.slice().reverse();
    const tabela = ops.length ? `<div class="tabela"><table>
        <thead><tr><th>Saída</th><th>Entrada</th><th>Venda</th><th>Resultado</th><th>Motivo</th></tr></thead>
        <tbody>${ops.map(o => `<tr><td>${fdata(o.saidaT)}</td><td>${fp(o.entrada)}</td><td>${fp(o.saida)}</td><td class="${cls(o.resultado)}">${fu(o.resultado)}</td><td>${esc(o.motivo)}</td></tr>`).join("")}</tbody>
      </table></div>` : `<div class="vazio">Nenhuma operação fechada ainda.</div>`;

    $("carteiraConteudo").innerHTML = `
      <div class="card">
        <h2>Carteira simulada · ${nomePar(S.par)} ${S.tf}</h2>
        <div class="grade">
          <div class="kpi"><span>Patrimônio</span><b>${fu(patr)} USDT</b></div>
          <div class="kpi"><span>Resultado</span><b class="${cls(result)}">${fpct(result)}</b></div>
          <div class="kpi"><span>Só segurar ${nomePar(S.par).split("/")[0]}</span><b class="${cls(base)}">${fpct(base)}</b></div>
          <div class="kpi"><span>Operações fechadas</span><b>${w.ops.length}</b></div>
          <div class="kpi"><span>Taxas e slippage pagos</span><b>${fu(w.custos)} USDT</b></div>
          <div class="kpi"><span>Rodando há</span><b>${dias < 1 ? duracao(Date.now() - cart.inicio) : nf(0, 0).format(dias) + " dias"}</b></div>
        </div>
        <p class="meta">Iniciada em ${fdata(cart.inicio)} com ${fu(cart.capital)} USDT · recalculada às ${fhora(Date.now())}</p>
        ${res && res.curva.length > 1 ? `<canvas id="curvaCart" aria-label="Evolução do patrimônio"></canvas>` : ""}
      </div>
      ${posicao}
      <div class="card"><h2>Operações</h2>${tabela}</div>
      <div class="card">
        <button class="btn perigo" id="zerarCart">Zerar esta carteira</button>
        <div class="botoes" id="confirmaZerar" hidden>
          <button class="btn sec" id="zerarNao">Cancelar</button>
          <button class="btn perigo" id="zerarSim">Apagar e recomeçar</button>
        </div>
      </div>`;
    if (res && res.curva.length > 1) {
      const pts = res.curva.slice(); pts[pts.length - 1] = { t: Date.now(), v: patr };
      desenharLinhas($("curvaCart"), [{ pts, cor: cor("--accent") }], 150);
    }
    $("zerarCart").onclick = () => { $("zerarCart").hidden = true; $("confirmaZerar").hidden = false; };
    $("zerarNao").onclick = () => { $("zerarCart").hidden = false; $("confirmaZerar").hidden = true; };
    $("zerarSim").onclick = () => { store.del(chaveCart()); S.carteiraCache = null; renderCarteiraVazia(); toast("Carteira apagada"); };
  }

  // ------------------------------------------------------------- aba BACKTEST
  async function rodarBacktest() {
    const bt = $("rodarBt"), out = $("btResultado");
    bt.disabled = true; bt.textContent = "Baixando candles…";
    try {
      const inicio = Date.now() - S.dias * 86400000;
      const k = soFechados(await klinesDesde(S.par, S.tf, inicio, n => { bt.textContent = `Baixando candles… ${n}`; }));
      if (k.length < CFG.emaFiltro + 50) {
        out.innerHTML = `<div class="aviso"><b>Poucos candles (${k.length}).</b> A estratégia precisa de pelo menos ${CFG.emaFiltro + 50} candles para aquecer a EMA 200. No tempo gráfico diário, escolha 1 ano ou mais.</div>`;
        return;
      }
      const r = Motor.rodar(k, {}), m = r.metricas;
      const resultado = m.capitalFinal - CFG.capital;
      const pesoCustos = resultado < 0 && m.custos > 0 ? Math.min(1, m.custos / -resultado) : null;
      const veredito = `O robô ${m.retorno >= 0 ? "ganhou" : "perdeu"} ${fpct(Math.abs(m.retorno)).replace("+", "")} no período. Só segurar ${nomePar(S.par).split("/")[0]} teria dado ${fpct(m.buyHold)}.`
        + (pesoCustos && pesoCustos > 0.5 ? ` Taxas e slippage (${fu(m.custos)} USDT) explicam ${nf(0, 0).format(pesoCustos * 100)}% da perda.` : "");
      const bh0 = k[CFG.emaFiltro].c;
      const bh = k.slice(CFG.emaFiltro).map(x => ({ t: x.t, v: CFG.capital * x.c / bh0 }));
      out.innerHTML = `
        <div class="card">
          <h2>${nomePar(S.par)} · ${S.tf} · ${fdia(k[0].t)} a ${fdia(k[k.length - 1].t)}</h2>
          <h3 class="${cls(m.retorno)}">${fpct(m.retorno)}</h3>
          <p>${veredito}</p>
          <div class="grade">
            <div class="kpi"><span>Capital final</span><b>${fu(m.capitalFinal)}</b></div>
            <div class="kpi"><span>Só segurar</span><b class="${cls(m.buyHold)}">${fpct(m.buyHold)}</b></div>
            <div class="kpi"><span>Pior queda</span><b class="neg">${fpct(m.drawdown)}</b></div>
            <div class="kpi"><span>Operações</span><b>${m.operacoes}</b></div>
            <div class="kpi"><span>Taxa de acerto</span><b>${nf(1, 1).format(m.acerto * 100)}%</b></div>
            <div class="kpi"><span>Fator de lucro</span><b>${isFinite(m.fatorLucro) ? nf(2, 2).format(m.fatorLucro) : "—"}</b></div>
            <div class="kpi"><span>Ganho médio</span><b class="pos">${fu(m.ganhoMedio)}</b></div>
            <div class="kpi"><span>Taxas e slippage</span><b>${fu(m.custos)}</b></div>
          </div>
          <canvas id="curvaBt" aria-label="Patrimônio do robô comparado a só segurar"></canvas>
          <div class="legenda"><span><i style="background:var(--accent)"></i>Robô</span><span><i style="background:var(--muted)"></i>Só segurar</span></div>
        </div>`;
      desenharLinhas($("curvaBt"), [{ pts: r.curva, cor: cor("--accent") }, { pts: bh, cor: cor("--muted"), esp: 1.3, tracejado: true }]);
    } catch (e) {
      out.innerHTML = `<div class="erro-box">Não consegui baixar o histórico (${esc(e.message)}). Tente de novo em instantes.</div>`;
    } finally {
      bt.disabled = false; bt.textContent = "Rodar backtest";
    }
  }

  // ------------------------------------------------------------- atualização principal
  async function atualizar() {
    if (S.carregando) return;
    S.carregando = true;
    try {
      const [k, t] = await Promise.all([
        klinesRecentes(S.par, S.tf, 500),
        api(`/api/v3/ticker/24hr?symbol=${S.par}`),
      ]);
      S.k = k; S.fech = soFechados(k); S.ind = Motor.calcular(S.fech, {});
      S.preco = +t.lastPrice; S.var24 = +t.priceChangePercent / 100;
      $("preco").textContent = fp(S.preco);
      const v = $("var24"); v.className = "pill " + (S.var24 >= 0 ? "up" : "down"); v.textContent = "24h " + fpct(S.var24);
      $("atualizado").textContent = `ao vivo · atualizado às ${fhora(Date.now())}`;
      $("status").className = "ok";
      renderSinal();
      if (S.aba === "carteira") atualizarCarteira(false);
    } catch (e) {
      $("status").className = "erro";
      $("atualizado").textContent = `sem conexão com a Binance (${e.message}) · tentando de novo`;
    } finally {
      S.carregando = false;
    }
  }

  function trocarAba(aba) {
    S.aba = aba; store.set("aba", aba);
    ["sinal", "carteira", "backtest", "sobre"].forEach(n => { $("aba-" + n).hidden = n !== aba; });
    document.querySelectorAll("nav.abas button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.aba === aba)));
    if (aba === "carteira") atualizarCarteira(false);
    if (aba === "sinal" && S.fech) renderSinal();
    window.scrollTo(0, 0);
  }

  function trocarMercado() {
    store.set("par", S.par); store.set("tf", S.tf);
    $("rotuloPar").textContent = `Binance · ${nomePar(S.par)} · ${S.tf}`;
    document.querySelectorAll("#tfs button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tf === S.tf)));
    $("par").value = S.par;
    S.carteiraCache = null; $("btResultado").innerHTML = "";
    $("preco").textContent = "carregando…";
    atualizar();
  }

  // ------------------------------------------------------------- eventos
  $("par").onchange = e => { S.par = e.target.value; trocarMercado(); };
  document.querySelectorAll("#tfs button").forEach(b => b.onclick = () => { S.tf = b.dataset.tf; trocarMercado(); });
  document.querySelectorAll("nav.abas button").forEach(b => b.onclick = () => trocarAba(b.dataset.aba));
  document.querySelectorAll("#dias button").forEach(b => b.onclick = () => {
    S.dias = +b.dataset.d; store.set("dias", S.dias);
    document.querySelectorAll("#dias button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  });
  document.querySelectorAll("#dias button").forEach(x => x.setAttribute("aria-pressed", String(+x.dataset.d === S.dias)));
  $("rodarBt").onclick = rodarBacktest;
  document.addEventListener("visibilitychange", () => { if (!document.hidden) atualizar(); });
  let larguraAnt = window.innerWidth;
  window.addEventListener("resize", () => { if (window.innerWidth !== larguraAnt) { larguraAnt = window.innerWidth; if (S.aba === "sinal" && S.fech) renderSinal(); } });
  setInterval(() => { if (!document.hidden) atualizar(); }, 30000);
  setInterval(() => { if (!document.hidden && S.k && S.aba === "sinal") { const f = S.k[S.k.length - 1].fim + 1; $("proximo").textContent = `próximo candle fecha em ${duracao(f - Date.now())} (${fhora(f)})`; if (Date.now() > f) atualizar(); } }, 20000);

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* app funciona sem offline */ });
  }

  trocarMercado();
  trocarAba(S.aba);
})();

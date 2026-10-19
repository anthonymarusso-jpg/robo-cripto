/* Motor da estratégia: mesma lógica do robô em Python (estrategias.py, carteira.py, backtest.py).
   Candles: arrays {t, o, h, l, c, v}. Funciona no navegador (window.Motor) e no Node (module.exports). */
(function (raiz) {
  "use strict";

  const PADRAO = {
    emaRapida: 9, emaLenta: 21, emaFiltro: 200, rsiPeriodo: 14, rsiMax: 70, atrPeriodo: 14,
    stopAtr: 3.0, alvoAtr: 4.0, trailing: true,
    capital: 1000, risco: 0.01, exposicao: 0.95, taxa: 0.001, slippage: 0.0005,
  };

  // ---------------------------------------------------------------- indicadores
  function ema(x, n) {
    const a = 2 / (n + 1), out = new Array(x.length);
    let prev = NaN;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      if (Number.isNaN(v)) { out[i] = prev; continue; }
      prev = Number.isNaN(prev) ? v : a * v + (1 - a) * prev;
      out[i] = prev;
    }
    return out;
  }

  function wilder(x, n) {           // ewm(alpha=1/n, adjust=False), ignorando NaN iniciais
    const a = 1 / n, out = new Array(x.length);
    let prev = NaN;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      if (Number.isNaN(v)) { out[i] = prev; continue; }
      prev = Number.isNaN(prev) ? v : a * v + (1 - a) * prev;
      out[i] = prev;
    }
    return out;
  }

  function rsi(c, n) {
    const g = [NaN], p = [NaN];
    for (let i = 1; i < c.length; i++) {
      const d = c[i] - c[i - 1];
      g.push(Math.max(d, 0)); p.push(Math.max(-d, 0));
    }
    const ag = wilder(g, n), ap = wilder(p, n);
    return ag.map((v, i) => {
      if (Number.isNaN(v) || !ap[i]) return 100;
      return 100 - 100 / (1 + v / ap[i]);
    });
  }

  function atr(k, n) {
    const tr = k.map((x, i) => i === 0 ? x.h - x.l
      : Math.max(x.h - x.l, Math.abs(x.h - k[i - 1].c), Math.abs(x.l - k[i - 1].c)));
    return wilder(tr, n);
  }

  // ---------------------------------------------------------------- sinais
  const COMPRA = 1, VENDA = -1, NADA = 0;

  function calcular(k, cfg) {
    cfg = Object.assign({}, PADRAO, cfg);
    const c = k.map(x => x.c);
    const er = ema(c, cfg.emaRapida), el = ema(c, cfg.emaLenta), ef = ema(c, cfg.emaFiltro);
    const r = rsi(c, cfg.rsiPeriodo), a = atr(k, cfg.atrPeriodo);
    const sinal = new Array(k.length).fill(NADA);
    const estado = new Array(k.length);
    for (let i = 0; i < k.length; i++) {
      const acima = er[i] > el[i], acimaAnt = i > 0 && er[i - 1] > el[i - 1];
      const ar = c[i] > er[i], arAnt = i > 0 && c[i - 1] > er[i - 1];
      const cruzouCima = acima && !acimaAnt;
      const cruzouBaixo = !acima && acimaAnt;
      const retomada = acima && ar && !arAnt;
      const filtroSubindo = i >= 10 && ef[i] > ef[i - 10];
      const regime = acima && c[i] > ef[i] && filtroSubindo;
      estado[i] = { regime, acima, acimaFiltro: c[i] > ef[i], filtroSubindo };
      if (i < cfg.emaFiltro) continue;
      if ((cruzouCima || retomada) && regime && r[i] < cfg.rsiMax) sinal[i] = COMPRA;
      else if (cruzouBaixo) sinal[i] = VENDA;
    }
    return { emaRapida: er, emaLenta: el, emaFiltro: ef, rsi: r, atr: a, sinal, estado };
  }

  // ---------------------------------------------------------------- carteira
  function novaCarteira(cfg) {
    return { caixa: cfg.capital, qtd: 0, entrada: 0, custoEntrada: 0, stop: 0, alvo: 0,
             maior: 0, entradaT: 0, ops: [], custos: 0 };
  }

  function comprar(w, cfg, preco, t, stop, alvo) {
    if (w.qtd > 0) return 0;
    const px = preco * (1 + cfg.slippage);
    const patrimonio = w.caixa;
    const riscoUnit = Math.max(px - stop, px * 0.002);
    let qtd = Math.max(0, Math.min(patrimonio * cfg.risco / riscoUnit, w.caixa * cfg.exposicao / (px * (1 + cfg.taxa))));
    if (qtd <= 0) return 0;
    let custo = qtd * px * (1 + cfg.taxa);
    if (custo > w.caixa) { qtd = w.caixa / (px * (1 + cfg.taxa)); custo = w.caixa; }
    w.custos += qtd * px * cfg.taxa + qtd * preco * cfg.slippage;
    w.caixa -= custo; w.qtd = qtd; w.entrada = px; w.custoEntrada = custo;
    w.stop = stop; w.alvo = alvo; w.maior = px; w.entradaT = t;
    return qtd;
  }

  function vender(w, cfg, preco, t, motivo, comSlippage) {
    if (w.qtd <= 0) return null;
    const px = comSlippage ? preco * (1 - cfg.slippage) : preco;
    const receita = w.qtd * px * (1 - cfg.taxa);
    w.custos += w.qtd * px * cfg.taxa + (comSlippage ? w.qtd * preco * cfg.slippage : 0);
    const res = receita - w.custoEntrada;
    const op = { entradaT: w.entradaT, entrada: w.entrada, qtd: w.qtd, saidaT: t, saida: px, motivo,
                 resultado: res, resultadoPct: res / w.custoEntrada * 100 };
    w.caixa += receita;
    Object.assign(w, { qtd: 0, entrada: 0, custoEntrada: 0, stop: 0, alvo: 0, maior: 0, entradaT: 0 });
    w.ops.push(op);
    return op;
  }

  /* Roda a estratégia candle a candle (sinal no fechamento, execução na abertura seguinte).
     inicio: índice a partir do qual pode operar (para a carteira simulada que começa numa data).
     fecharNoFim: vende a posição aberta no último candle (backtest) ou mantém aberta (carteira ao vivo). */
  function rodar(k, cfgIn, opts) {
    const cfg = Object.assign({}, PADRAO, cfgIn);
    opts = Object.assign({ inicio: 1, fecharNoFim: true }, opts);
    const ind = calcular(k, cfg);
    const w = novaCarteira(cfg);
    const curva = [];
    const ini = Math.max(1, opts.inicio);
    for (let i = ini; i < k.length; i++) {
      const x = k[i], s = ind.sinal[i - 1];
      if (w.qtd > 0 && s === VENDA) vender(w, cfg, x.o, x.t, "cruzamento p/ baixo", true);
      else if (w.qtd === 0 && s === COMPRA) {
        const a = ind.atr[i - 1];
        comprar(w, cfg, x.o, x.t, x.o - cfg.stopAtr * a, cfg.alvoAtr ? x.o + cfg.alvoAtr * a : 0);
      }
      if (w.qtd > 0) {
        if (x.l <= w.stop) vender(w, cfg, Math.min(x.o, w.stop), x.t, "stop loss", true);
        else if (w.alvo && x.h >= w.alvo) vender(w, cfg, Math.max(x.o, w.alvo), x.t, "alvo", false);
      }
      if (w.qtd > 0 && cfg.trailing) {
        w.maior = Math.max(w.maior, x.h);
        const novo = w.maior - cfg.stopAtr * ind.atr[i];
        if (novo > w.stop) w.stop = novo;
      }
      curva.push({ t: x.t, v: w.caixa + w.qtd * x.c });
    }
    if (opts.fecharNoFim && w.qtd > 0) {
      const u = k[k.length - 1];
      vender(w, cfg, u.c, u.t, "fim do teste", true);
      curva[curva.length - 1] = { t: u.t, v: w.caixa };
    }
    return { carteira: w, curva, ind, metricas: metricas(k, curva, w, cfg, ini) };
  }

  function metricas(k, curva, w, cfg, ini) {
    if (!curva.length) return null;
    let pico = -Infinity, dd = 0;
    for (const p of curva) { pico = Math.max(pico, p.v); dd = Math.min(dd, (p.v - pico) / pico); }
    const base = k[Math.max(ini, cfg.emaFiltro)] || k[ini];
    const ganhos = w.ops.filter(o => o.resultado > 0), perdas = w.ops.filter(o => o.resultado <= 0);
    const soma = a => a.reduce((s, o) => s + o.resultado, 0);
    const final = curva[curva.length - 1].v;
    return {
      capitalFinal: final,
      retorno: final / cfg.capital - 1,
      buyHold: k[k.length - 1].c / base.c - 1,
      drawdown: dd,
      operacoes: w.ops.length,
      acerto: w.ops.length ? ganhos.length / w.ops.length : 0,
      ganhoMedio: ganhos.length ? soma(ganhos) / ganhos.length : 0,
      perdaMedia: perdas.length ? soma(perdas) / perdas.length : 0,
      fatorLucro: soma(perdas) ? soma(ganhos) / Math.abs(soma(perdas)) : (ganhos.length ? Infinity : 0),
      custos: w.custos,
    };
  }

  const Motor = { PADRAO, COMPRA, VENDA, NADA, ema, rsi, atr, calcular, rodar };
  if (typeof module !== "undefined" && module.exports) module.exports = Motor;
  else raiz.Motor = Motor;
})(typeof window !== "undefined" ? window : globalThis);

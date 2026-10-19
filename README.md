# Robô Cripto (app para celular)

App web com a estratégia de tendência do robô em Python (EMA 9/21, filtro EMA 200, RSI, stop e alvo por ATR):

- **Sinal**: estado da estratégia no último candle fechado, com gráfico e níveis de stop/alvo
- **Carteira**: carteira simulada com 1.000 USDT que segue os sinais desde a data de início
- **Backtest**: teste com o histórico real da Binance (taxa 0,1% + slippage 0,05%)

Preços: API pública da Binance (`data-api.binance.vision`). Nenhum dado sai do aparelho. Só simulação, não é recomendação de investimento.

No iPhone: abra no Safari → Compartilhar → Adicionar à Tela de Início.

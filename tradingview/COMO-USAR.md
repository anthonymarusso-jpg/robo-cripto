# Robô Cripto no TradingView

## Instalar
1. Abra o TradingView no computador (tradingview.com) e abra um gráfico.
2. Embaixo, clique em **Pine Editor**.
3. Apague o que estiver lá, cole todo o conteúdo de `robo-cripto.pine` e clique em **Salvar**.
4. Clique em **Adicionar ao gráfico**.

## Ver o backtest
Aba **Strategy Tester** (Testador de estratégia), embaixo do gráfico: lucro, número de operações, taxa de acerto, pior queda e a lista de operações.
A comissão vem em 0,15% por ordem (0,1% de taxa + 0,05% de slippage). Mude em **Configurações → Propriedades**.

## Usar em outros ativos e corretoras
Troque o símbolo no topo do gráfico: `BINANCE:BTCUSDT`, `BYBIT:ETHUSDT`, `COINBASE:BTCUSD`, `BMFBOVESPA:PETR4`, `FX:USDBRL`...
Ajuste a comissão para a da sua corretora.

## Receber alertas no celular
1. Clique no relógio (**Alertas**) → **Criar alerta**.
2. Condição: **Robô Cripto** → **Chamadas da função alert()**.
3. Em notificações, marque **Notificar no app**.
4. Instale o app do TradingView no iPhone com a mesma conta.

Cada alerta vale para um símbolo e um tempo gráfico. Ferramenta de estudo, não é recomendação de investimento.

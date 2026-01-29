# Plataforma CDL - Painel Demo Executivo

Este repositorio contem apenas o frontend (statico) do painel demo da CDL.

## Como abrir

Opcoes simples para rodar localmente:

- Com Node (recomendado):
  - `npx serve .`
  - abra o endereco exibido no terminal

- Com Python:
  - `python -m http.server 5500`
  - acesse `http://localhost:5500`

## Estrutura

- `index.html` - layout executivo do painel
- `styles.css` - identidade visual
- `app.js` - interacoes do demo (sem chamadas ao vivo)
- `demo-conversations.json` - conversas ficticias com botoes/listas de pagamento

## Observacao

As conversas sao ficticias e servem apenas para demonstracao do fluxo de negociacao.

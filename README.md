# Caixa da Barbearia ✂️

Sistema de caixa pra barbearia: cada barbeiro lança os próprios atendimentos e acompanha quanto ganhou,
e o dono tem um painel com todos os números da casa e o cadastro da equipe.

Não precisa instalar nenhuma dependência: roda só com o Node.js (versão 22.5 ou mais nova), usando o
SQLite que já vem com ele.

| Tela do barbeiro (celular) | Painel do dono |
| --- | --- |
| <img src="docs/tela-barbeiro.png" width="260"> | <img src="docs/painel-dono.png" width="520"> |

## O que tem

**Tela do barbeiro** (`/barbeiro.html`), feita pra usar no celular
- Entra escolhendo o nome e digitando o PIN.
- Lança o atendimento em 3 toques: serviço (com preço sugerido), valor e forma de pagamento.
- Antes de lançar já mostra quanto ele vai ganhar naquele atendimento.
- Vê os números de hoje, ontem, 7 dias ou do mês: **atendimentos**, **faturado**, **ticket médio** e **meu ganho** (com a % de comissão).
- Pode excluir um lançamento errado, só do dia de hoje (dias anteriores só o dono mexe).

**Painel do dono** (`/admin.html`)
- *Visão geral*: faturamento, atendimentos, ticket médio, total de comissões e quanto fica pra casa (com a margem em %).
- Tabela por barbeiro: comissão, atendimentos, faturado, ticket médio, ganho do barbeiro, quanto fica pra casa e % do faturamento total.
- Gráfico de faturamento por dia, divisão por forma de pagamento e por serviço.
- Filtro de período: hoje, ontem, 7 dias, este mês, 30 dias ou datas escolhidas.
- *Atendimentos*: lista de tudo que foi lançado, filtro por barbeiro, lançar pelo caixa e excluir.
- *Barbeiros*: cadastrar (nome, % de comissão, PIN), editar e excluir.

## Como rodar

```bash
ADMIN_PIN=4821 NOME_BARBEARIA="Barbearia do Zé" npm start
```

Abra `http://localhost:3000`, entre como **dono** com o PIN definido e cadastre os barbeiros na aba *Barbeiros*.
Cada barbeiro entra com o PIN que você cadastrou pra ele.

### Configuração (variáveis de ambiente)

| Variável | Padrão | Pra quê |
| --- | --- | --- |
| `ADMIN_PIN` | `1234` | PIN do painel do dono. **Troque antes de usar.** |
| `NOME_BARBEARIA` | `Barbearia` | Nome que aparece nas telas. |
| `PORT` | `3000` | Porta do servidor. |
| `TZ_BARBEARIA` | `America/Sao_Paulo` | Fuso usado pra definir o "dia" do caixa. |
| `DATA_DIR` | `./data` | Onde fica o banco (`barbearia.db`). Faça backup dessa pasta. |
| `SECRET` | gerado em `DATA_DIR/.segredo` | Chave que assina as sessões. |

Os serviços sugeridos e as formas de pagamento ficam em `src/config.js`.

## Regras de negócio

- **Dinheiro em centavos** no banco, pra não ter erro de arredondamento.
- **Comissão congelada no lançamento**: cada atendimento guarda a % do barbeiro naquele momento.
  Se o dono mudar a comissão depois, o histórico não muda — só os próximos lançamentos.
- **Ganho do barbeiro** = valor × comissão. **Fica pra casa** = faturamento − comissões.
- **Ticket médio** = faturamento ÷ número de atendimentos.
- **Excluir barbeiro**: se ele não tem nenhum lançamento, é apagado. Se tem, ele perde o acesso e some
  da equipe, mas os atendimentos dele continuam nos relatórios (aparecem marcados como "removido").
- **Segurança**: PIN guardado com hash (scrypt), sessão assinada que expira em 12h, trava de 15 minutos
  depois de 8 PINs errados no mesmo IP, e trocar o PIN de um barbeiro derruba a sessão dele.

## Estrutura

```
server.js            inicia o servidor
src/app.js           rotas da API, autenticação e arquivos estáticos
src/db.js            banco SQLite (barbeiros e atendimentos)
src/stats.js         cálculo dos indicadores (ticket médio, comissões, etc.)
src/auth.js          PIN, sessões e trava de tentativas
src/datas.js         datas no fuso da barbearia
public/              telas (HTML, CSS e JS puros)
test/                testes (npm test)
```

## API

| Método | Rota | Quem |
| --- | --- | --- |
| `GET` | `/api/config` | todos |
| `GET` | `/api/barbeiros` | todos (só id e nome, pro login) |
| `POST` | `/api/login` | todos |
| `GET` | `/api/eu`, `/api/eu/resumo?inicio=&fim=` | barbeiro |
| `POST` | `/api/eu/atendimentos` | barbeiro |
| `DELETE` | `/api/eu/atendimentos/:id` | barbeiro (só de hoje) |
| `GET` | `/api/admin/resumo?inicio=&fim=` | dono |
| `GET`/`POST` | `/api/admin/atendimentos` | dono |
| `DELETE` | `/api/admin/atendimentos/:id` | dono |
| `GET`/`POST` | `/api/admin/barbeiros` | dono |
| `PATCH`/`DELETE` | `/api/admin/barbeiros/:id` | dono |

## Testes

```bash
npm test
```

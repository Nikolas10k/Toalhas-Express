from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle)

F = '/usr/share/fonts/truetype/dejavu/'
pdfmetrics.registerFont(TTFont('Sans', F + 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('Sans-Bold', F + 'DejaVuSans-Bold.ttf'))
pdfmetrics.registerFontFamily('Sans', normal='Sans', bold='Sans-Bold', italic='Sans', boldItalic='Sans-Bold')

BLUE = colors.HexColor('#0f4c81')
LIGHT = colors.HexColor('#eaf2fa')
GREY = colors.HexColor('#5b6573')
WARN = colors.HexColor('#fff4e0')

body = ParagraphStyle('body', fontName='Sans', fontSize=10, leading=14.5, spaceAfter=5)
small = ParagraphStyle('small', parent=body, fontSize=8.5, leading=12, textColor=GREY)
h1 = ParagraphStyle('h1', fontName='Sans-Bold', fontSize=18, leading=23, textColor=BLUE, spaceBefore=4, spaceAfter=10)
h2 = ParagraphStyle('h2', fontName='Sans-Bold', fontSize=13, leading=17, textColor=BLUE, spaceBefore=10, spaceAfter=5)
h3 = ParagraphStyle('h3', fontName='Sans-Bold', fontSize=10.5, leading=14, spaceBefore=6, spaceAfter=3)
cell = ParagraphStyle('cell', parent=body, fontSize=9, leading=12.5, spaceAfter=0)
cellb = ParagraphStyle('cellb', parent=cell, fontName='Sans-Bold')
bullet = ParagraphStyle('bullet', parent=body, leftIndent=14, bulletIndent=3, spaceAfter=2)
step = ParagraphStyle('step', parent=body, leftIndent=18, bulletIndent=0, spaceAfter=3)

story = []


def P(t, s=body):
    story.append(Paragraph(t, s))


def bullets(items):
    for i in items:
        story.append(Paragraph(i, bullet, bulletText='•'))


def steps(items):
    for n, i in enumerate(items, 1):
        story.append(Paragraph(i, step, bulletText=f'{n}.'))


def table(rows, widths, header=True):
    data = [[Paragraph(str(c), cellb if (header and r == 0) else cell) for c in row] for r, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    st = [
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#c9d3de')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]
    if header:
        st.append(('BACKGROUND', (0, 0), (-1, 0), LIGHT))
    t.setStyle(TableStyle(st))
    story.append(t)
    story.append(Spacer(1, 6))


def box(title, text, bg=LIGHT):
    t = Table([[Paragraph(f'<b>{title}</b><br/>{text}', cell)]], colWidths=[17 * cm])
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), bg), ('BOX', (0, 0), (-1, -1), 0.5, BLUE),
                           ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
                           ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
    story.append(KeepTogether([t, Spacer(1, 8)]))


# ----------------------------------------------------------------------------- Capa
story.append(Spacer(1, 5 * cm))
story.append(Paragraph('Toalhas Express', ParagraphStyle('cap', parent=h1, fontSize=30, leading=36, alignment=TA_CENTER)))
story.append(Paragraph('Manual de uso do sistema', ParagraphStyle('cap2', parent=h2, fontSize=16, alignment=TA_CENTER)))
story.append(Spacer(1, 0.6 * cm))
story.append(Paragraph('Guia de treinamento por função: administrativo, lavanderia, separação, motoristas e clientes',
                       ParagraphStyle('cap3', parent=body, alignment=TA_CENTER, textColor=GREY)))
story.append(Spacer(1, 6 * cm))
story.append(Paragraph('Endereço: <b>toalhas-express.vercel.app</b><br/>Versão: setembro/2026 — cobre até a Fase 8B (contratos, lavanderia enxuta e enxoval de hotéis). '
                       'Financeiro, cobrança Asaas e WhatsApp entram nas próximas versões.', ParagraphStyle('cap4', parent=small, alignment=TA_CENTER)))
story.append(PageBreak())

# ----------------------------------------------------------------------------- Sumário
P('Sumário', h1)
for i, t in enumerate([
    'Como o sistema funciona (visão de uma página)',
    'Quem usa o quê (perfis)',
    'Primeiro acesso',
    'Administrativo: clientes, produtos e contratos',
    'Administrativo: pedidos, rotas e romaneio',
    'Lavanderia (líder de turno)',
    'Separação para as rotas',
    'Motoristas (app no celular)',
    'Portal do cliente',
    'Rotina diária — checklists',
    'Situações comuns e como resolver',
    'Dicas para o treinamento',
], 1):
    P(f'{i}. {t}')
story.append(PageBreak())

# ----------------------------------------------------------------------------- 1
P('1. Como o sistema funciona', h1)
P('A empresa tem <b>dois negócios</b> dentro da mesma operação. O sistema trata cada um de um jeito, para que o estoque nunca fique errado.')
table([
    ['', 'Toalhas de aluguel', 'Enxoval de clientes (hotéis e spas)'],
    ['De quem é a peça', 'Da Toalhas Express (nosso estoque)', 'Do cliente — lavamos e devolvemos'],
    ['Controle', 'Estoque por estado: disponível, com cliente, suja, danificada…', 'Ordem de Serviço (OS) com o rol de peças'],
    ['Como se cobra', 'Conforme o contrato: mensalidade, por entrega, por peça ou franquia + excedente', 'Por peça higienizada (rol da coleta)'],
    ['Na lavanderia', '"Lançar produção" quando o carrinho sai pronto', '"Pronta" na OS quando o enxoval sai'],
], [3.2 * cm, 6.9 * cm, 6.9 * cm])

P('Caminho da toalha de aluguel', h2)
table([
    ['Etapa', 'O que acontece', 'Quem faz no sistema'],
    ['Pedido', 'Cliente pede (portal, WhatsApp ou telefone) e o pedido é confirmado', 'Administrativo'],
    ['Rota', 'Pedidos confirmados entram numa rota com motorista e veículo', 'Administrativo'],
    ['Separação', 'Toalhas saem do estoque para a van, conferindo o romaneio', 'Separação'],
    ['Entrega/coleta', 'Motorista registra entregues e coletadas na frente do cliente', 'Motorista'],
    ['Lavanderia', 'Sujas entram sozinhas na fila; ao sair pronto, lança-se a produção', 'Líder da lavanderia'],
    ['Estoque', 'As boas voltam a "disponível" e já podem sair de novo', 'Automático'],
], [3 * cm, 9.5 * cm, 4.5 * cm])

P('Caminho do enxoval do hotel', h2)
table([
    ['Etapa', 'O que acontece', 'Quem faz'],
    ['Coleta', 'Motorista conta o rol (lençóis, fronhas, roupões…) → nasce a OS', 'Motorista'],
    ['Lavanderia', 'Lava, seca, calandra/dobra. Ao sair, confere e marca a OS "Pronta"', 'Líder da lavanderia'],
    ['Programar entrega', 'No planejamento de rotas: "Gerar entregas" (um pedido por hotel)', 'Administrativo'],
    ['Entrega', 'Motorista entrega o limpo e já recolhe o sujo (nova OS)', 'Motorista'],
    ['Cobrança', 'Peças do rol × preço por peça do contrato', 'Automático no fechamento'],
], [3 * cm, 9.5 * cm, 4.5 * cm])
box('Regra de ouro', 'Nada some e nada é corrigido em silêncio. Toda diferença (faltou toalha, veio a mais, rasgou) vira uma <b>ocorrência</b> '
    'que alguém analisa e resolve. O sistema guarda quem fez o quê e quando.')
story.append(PageBreak())

# ----------------------------------------------------------------------------- 2
P('2. Quem usa o quê', h1)
table([
    ['Perfil', 'Para quem', 'O que vê e faz'],
    ['Administrador', 'Dona / gestão', 'Tudo. Exige código do app autenticador (segurança extra).'],
    ['Gerente', 'Quem ajuda no administrativo', 'Clientes, contratos, pedidos, rotas, estoque, ocorrências. Sem configurações sensíveis.'],
    ['Operador', 'Líder de turno da lavanderia e quem separa as rotas', 'Lavanderia (produção e OS), rotas e romaneio. Não vê clientes, contratos nem financeiro.'],
    ['Motorista', 'Os 2 motoristas', 'Só as próprias rotas no celular: atender paradas, fotos, problemas.'],
    ['Cliente', 'Clientes com acesso ao portal', 'Os próprios pedidos, toalhas em posse, contrato e dados.'],
], [3 * cm, 4.5 * cm, 9.5 * cm])
P('Sugestão para a equipe atual: a dona como Administradora; <b>um líder por turno</b> (7h–15h e 15h–23h) como Operador; '
  'os 2 motoristas como Motorista. Os demais operacionais da lavanderia não precisam usar o sistema.')
story.append(Spacer(1, 6))

P('3. Primeiro acesso', h1)
P('Criar os usuários (Administradora)', h3)
steps([
    'Menu <b>Administração → Usuários → Convidar</b>.',
    'Informe nome, e-mail e o perfil (Operador, Motorista…).',
    'A pessoa recebe um e-mail, clica no link e cria a própria senha.',
    'Motorista: depois, em <b>Rotas → Motoristas</b>, vincule o usuário ao cadastro do motorista e ao veículo padrão.',
])
P('Administradora: código de segurança', h3)
P('No primeiro login, o sistema pede para ativar o app autenticador (Google Authenticator, Microsoft Authenticator ou similar). '
  'Aponte a câmera para o QR Code e digite o código de 6 dígitos. Nos próximos acessos, o código é pedido de novo em ações sensíveis.')
P('Motorista: instalar o app no celular', h3)
steps([
    'Abra o endereço do sistema no navegador do celular e faça login.',
    'Android (Chrome): menu ⋮ → <b>Adicionar à tela inicial</b>. iPhone (Safari): botão compartilhar → <b>Adicionar à Tela de Início</b>.',
    'Permita o acesso à <b>câmera</b> (fotos de comprovação) e à <b>localização</b> (registro da entrega).',
])
story.append(PageBreak())

# ----------------------------------------------------------------------------- 4
P('4. Administrativo: clientes, produtos e contratos', h1)
P('Clientes', h2)
bullets([
    '<b>Clientes → Novo cliente</b>: PF ou PJ, CPF/CNPJ, contato, WhatsApp, endereço (o CEP preenche a rua). O sistema acha a localização no mapa.',
    'Cliente que se cadastrou sozinho aparece como <b>Aguardando aprovação</b>: abra e clique em Aprovar.',
    'A ficha do cliente (visão 360°) tem abas: Resumo, Pedidos, Toalhas (quanto ele tem), Entregas/Coletas, Ocorrências, <b>Contrato</b>, <b>Enxoval</b> (OS do hotel), Comunicação e Auditoria.',
    'Dar acesso ao portal: na ficha, <b>Convidar para o portal</b> com o e-mail do responsável.',
])
P('Produtos', h2)
bullets([
    '<b>Estoque → Produtos → Novo produto</b>. Escolha o <b>Tipo</b>:',
    '<b>Toalha de aluguel</b>: nossa toalha, controlada no estoque. Informe preço de reposição (usado em perda/dano), estoque mínimo e a quantidade inicial.',
    '<b>Enxoval do cliente</b>: peça do hotel/spa (lençol casal, fronha, toalha de banho do hotel, roupão…). Não tem estoque.',
    'Para aumentar o estoque depois (compra de toalhas novas): botão <b>Dar entrada</b> na lista de produtos.',
])
P('Contratos', h2)
steps([
    '<b>Contratos → Novo contrato</b> (ou pela aba Contrato do cliente). O contrato nasce como <b>Rascunho</b>.',
    'Escolha o tipo de cobrança: mensalidade fixa, por entrega, por peça entregue, híbrido (mensalidade com franquia + excedente) ou personalizado.',
    'Adicione os produtos. Toalha de aluguel: quantidade, franquia, excedente, preço de perda e de dano. '
    '<b>Enxoval do cliente: só o preço por peça higienizada</b> — ele é cobrado em qualquer tipo de contrato.',
    'Confira e clique em <b>Ativar</b>. Cada cliente só pode ter um contrato vigente.',
    'Reajuste: <b>Editar</b> e informar o motivo (ex.: "Reajuste anual IPCA"). A versão anterior fica guardada no histórico.',
    'Aba <b>Simular mês</b>: mostra quanto o cliente pagaria no mês com as entregas e coletas reais. Use para conferir antes do fechamento.',
])
box('Exemplo', 'Hotel com contrato "por peça": lençol R$ 2,50 e fronha R$ 1,00. No mês foram coletados 80 lençóis e 20 fronhas '
    '→ 80 × 2,50 + 20 × 1,00 = <b>R$ 220,00</b>.')
story.append(PageBreak())

# ----------------------------------------------------------------------------- 5
P('5. Administrativo: pedidos, rotas e romaneio', h1)
P('Pedidos', h2)
bullets([
    '<b>Pedidos → Novo pedido</b>: cliente, tipo (entrega, coleta ou os dois), data, janela de horário e quantidades.',
    'Marque <b>Confirmar agora</b> para já reservar as toalhas no estoque. Sem estoque, o sistema avisa "Estoque insuficiente".',
    'Pedidos do portal chegam como <b>Novo</b>: abra e confirme.',
    'Clientes com rotina fixa: <b>Pedidos → Recorrências</b> (dias da semana, itens). O sistema cria os pedidos sozinho.',
    'Coleta de enxoval de hotel: pedido de <b>coleta</b> com as peças de enxoval (a quantidade é estimada; vale o que o motorista contar).',
])
P('Montar a rota do dia', h2)
steps([
    '<b>Rotas → Nova rota</b> e escolha a data.',
    'Se houver enxoval pronto, aparece o aviso <b>"OS de enxoval pronta(s)… Gerar entregas para [data]"</b>. Clique: o sistema cria os pedidos de entrega dos hotéis.',
    'Marque os pedidos no mapa ou na lista, escolha motorista e veículo e salve.',
    'Na rota: <b>Otimizar ordem</b> calcula o melhor caminho (Google), saindo e voltando à base.',
    'Clique em <b>Romaneio</b> para imprimir a lista de separação (próxima seção).',
    'Acompanhe a rota ao vivo; no fim do dia, se o motorista esquecer, <b>Encerrar rota</b>.',
])
P('Ocorrências', h2)
P('<b>Operação → Ocorrências</b> reúne tudo que precisa de decisão: falta na coleta, dano, cliente fechado, peça de enxoval faltando. '
  'Abra, analise e escolha a decisão (ex.: registrar perda, devolver ao estoque, descartar, cobrar do cliente). '
  'Perdas e danos cobráveis usam o preço do contrato.')
story.append(PageBreak())

# ----------------------------------------------------------------------------- 6
P('6. Lavanderia (líder de turno)', h1)
P('O processo foi desenhado para ser <b>enxuto</b>: a equipe lava, seca, passa e dobra normalmente. '
  'O líder só registra quando algo <b>sai pronto</b>. Menu: <b>Estoque → Lavanderia</b> (funciona bem no tablet ou celular).')
P('A) Toalhas de aluguel — Lançar produção', h2)
steps([
    'Aba <b>Toalhas de aluguel</b>: mostra quantas sujas estão aguardando, por produto. Elas entram sozinhas pela contagem do motorista.',
    'Saiu um carrinho limpo e dobrado? Toque em <b>Lançar produção</b>.',
    'Para cada produto, informe: <b>Boas</b>, <b>Com dano</b> e <b>Descarte</b>.',
    'Se houver dano, escolha o tipo (rasgada, manchada, queimada, desfiada, gasta).',
    'Toque em <b>Lançar</b>. As boas voltam na hora para o estoque disponível; as com dano viram ocorrência.',
])
box('Frequência', 'Lance algumas vezes por turno (a cada carrinho ou pilha pronta). Não precisa registrar máquina por máquina.')
P('B) Chegou diferente do que o motorista contou?', h2)
P('Só quando as sacas não baterem: em <b>Chegadas recentes</b>, toque em <b>Informar diferença</b> na rota, digite quanto chegou de fato e registre. '
  'O sistema abre uma ocorrência. Se bateu, <b>não precisa fazer nada</b>.')
P('C) Enxoval de hotéis — marcar OS como Pronta', h2)
steps([
    'Aba <b>Enxoval de clientes</b> → filtro "Na lavanderia": lista as OS com hotel e peças.',
    'Quando o enxoval daquele hotel sair pronto, toque em <b>Pronta</b>.',
    'As quantidades já vêm preenchidas com o que foi coletado. Confira e corrija se faltar alguma peça.',
    'Se faltar peça, o sistema pede <b>o que aconteceu</b> (ex.: "rasgou na calandra") e abre ocorrência. A roupa é do cliente: isso é importante.',
    'Confirme. A OS fica "Pronta" e aparece para o administrativo programar a entrega.',
])
box('Não misturar', 'Enxoval de hotel nunca vai para as prateleiras das toalhas de aluguel. Separe por hotel (etiqueta ou saco com o número da OS).', WARN)
P('Tabela do dia na lavanderia', h2)
table([
    ['Momento', 'No sistema'],
    ['Chegada da rota', 'Nada (só "Informar diferença" se não bater)'],
    ['Lavar, secar, calandrar, dobrar', 'Nada'],
    ['Carrinho de toalhas pronto', 'Lançar produção'],
    ['Enxoval de um hotel pronto', 'OS → Pronta'],
    ['Troca de turno', 'Conferir a aba Enxoval: o que está "Na lavanderia" passa para o próximo líder'],
    ['23h', 'Fechamento: conferir se sujas na tela ≈ sacas no chão'],
], [7 * cm, 10 * cm])
story.append(PageBreak())

# ----------------------------------------------------------------------------- 7
P('7. Separação para as rotas', h1)
steps([
    'Abra a rota do dia (<b>Rotas</b> → clique na rota) e toque em <b>Romaneio</b>. Pode imprimir ou usar no tablet.',
    '<b>Separar do estoque</b>: total por tipo de toalha para colocar na van. Marque [✓] ao separar.',
    '<b>Enxoval pronto de clientes</b>: o que vai para cada hotel. Separe por hotel, sem misturar com as toalhas de aluguel.',
    '<b>Por parada</b>: a ordem da rota, com o que entregar e coletar em cada cliente. Ajuda a arrumar a van na ordem.',
    'Assine "Conferido por" e a hora de saída no rodapé (versão impressa).',
])
box('Dica', 'Separe à noite (turno das 15h–23h) a rota do dia seguinte: o motorista chega de manhã e só carrega.')

# ----------------------------------------------------------------------------- 8
P('8. Motoristas (app no celular)', h1)
steps([
    'Abra o app: aparece a rota do dia com as paradas na ordem.',
    'Toque em <b>Iniciar rota</b> (as toalhas saem do estoque "em rota" automaticamente).',
    'Em cada parada: <b>Navegar</b> abre o Google Maps/Waze. Ao chegar, toque em <b>Atender</b>.',
    '<b>Toalhas de aluguel</b>: confirme quantas <b>entregou</b> e quantas <b>coletou</b>. Se coletar toalha com dano, informe quantas e o tipo.',
    '<b>Enxoval do cliente</b> (hotéis): informe as peças <b>entregues limpas</b> e <b>conte o rol</b> das sujas coletadas, peça por peça. '
    'Se o hotel mandar uma peça fora do previsto, use <b>Adicionar peça de enxoval</b>. Informe as que já vieram com dano.',
    'Digite o <b>nome de quem recebeu</b> e tire a <b>foto</b> do comprovante (se exigida).',
    'Toque em <b>Concluir atendimento</b>. Se algo não bateu, o app avisa que vai abrir ocorrência para a equipe — é normal.',
    'Cliente fechado, recusou ou endereço errado: <b>Registrar problema</b> (com foto, se possível).',
    'No fim do dia: <b>Finalizar rota</b>. O que não foi entregue volta sozinho para o estoque.',
])
box('Importante para o motorista', 'O número que ele digita é o que vale para cobrar o cliente e para o estoque. '
    'Contar com atenção na frente do cliente evita discussão depois.', WARN)
story.append(PageBreak())

# ----------------------------------------------------------------------------- 9
P('9. Portal do cliente', h1)
P('O cliente acessa pelo mesmo endereço, com o e-mail convidado. No celular, ele vê:')
bullets([
    '<b>Novo pedido</b>: escolhe data, janela e quantidades. O pedido chega para a equipe confirmar.',
    '<b>Meus pedidos</b>: status de cada pedido (confirmado, em rota, entregue…).',
    '<b>Minhas toalhas</b>: quantas toalhas estão com ele, com datas da última entrega e coleta.',
    '<b>Meu contrato</b>: condições, franquia e preços de perda e dano.',
    '<b>Meus dados</b>: atualizar contato e endereço.',
    '<b>Financeiro</b>: boletos, Pix e 2ª via — disponível numa próxima versão.',
])

# ----------------------------------------------------------------------------- 10
P('10. Rotina diária — checklists', h1)
table([
    ['Quem', 'Manhã', 'Durante o dia', 'Fim do dia'],
    ['Administrativo', 'Confirmar pedidos novos; conferir rotas do dia', 'Responder ocorrências; criar pedidos que chegarem por WhatsApp/telefone',
     'Montar rotas de amanhã (e "Gerar entregas" do enxoval); ver rotas encerradas'],
    ['Líder da lavanderia', 'Ver sujas e OS na tela', 'Lançar produção a cada carrinho; marcar OS prontas', 'Passar o turno / fechamento às 23h'],
    ['Separação', 'Conferir van com o romaneio', '—', 'Separar a rota do dia seguinte'],
    ['Motorista', 'Iniciar rota', 'Atender cada parada no app', 'Finalizar rota; entregar sacas na lavanderia'],
], [3 * cm, 4.2 * cm, 5 * cm, 4.8 * cm])
P('Semanal / mensal (administrativo)', h3)
bullets([
    'Estoque → Visão geral: conferir alertas (estoque mínimo, divergências).',
    'Perdas/Danos: resolver pendências.',
    'Contratos: rodar <b>Simular mês</b> dos principais clientes antes do fechamento.',
])
story.append(PageBreak())

# ----------------------------------------------------------------------------- 11
P('11. Situações comuns e como resolver', h1)
table([
    ['Situação', 'O que fazer'],
    ['Pedido confirmado não aparece para montar rota', 'Confira a data do pedido e se ele está confirmado. Pedidos "Novo" precisam ser confirmados.'],
    ['"Estoque insuficiente" ao confirmar', 'Lance a produção da lavanderia (toalhas prontas ainda não lançadas) ou dê entrada de toalhas novas.'],
    ['Motorista coletou menos do que o cliente tem', 'Normal: vira ocorrência e o saldo continua com o cliente. Na próxima coleta ele recolhe.'],
    ['"Mais do que as sujas registradas" ao lançar produção', 'Alguma coleta não foi registrada. Verifique com o motorista e peça ao administrativo para ajustar.'],
    ['Enxoval pronto não aparece para entregar', 'A OS precisa estar "Pronta". Depois, no planejamento de rotas, "Gerar entregas".'],
    ['Coleta de enxoval registrada no hotel errado', 'Na OS, cancelar com o motivo (só antes de ficar pronta) e registrar a coleta correta.'],
    ['Toalha rasgou na lavanderia', 'Lance como "Com dano" na produção. Vira ocorrência para decidir: descartar ou voltar ao estoque.'],
    ['Peça de hotel sumiu', 'Ao marcar a OS como Pronta, corrija a quantidade e explique. A ocorrência fica registrada.'],
    ['Motorista esqueceu de finalizar a rota', 'Administrativo: abrir a rota e "Encerrar rota".'],
    ['Esqueci a senha', 'Tela de login → "Esqueci minha senha".'],
], [6 * cm, 11 * cm])

P('12. Dicas para o treinamento', h1)
bullets([
    'Treine por função: cada pessoa só precisa aprender a sua seção (Lavanderia: seção 6; Motorista: seção 8; Separação: seção 7).',
    'Faça um <b>dia de simulação</b> com dados de teste: um pedido, uma rota curta, uma coleta de enxoval, uma produção lançada.',
    'Nas 2 primeiras semanas, rode em paralelo com o controle atual e compare os números no fim do dia.',
    'Motoristas: pratique a contagem do rol de enxoval com um hotel parceiro antes de valer.',
    'Anote dúvidas e ajustes pedidos pela equipe — o sistema pode ser ajustado ao processo real.',
])


def footer(c, d):
    if d.page == 1:
        return
    c.saveState()
    c.setFont('Sans', 8)
    c.setFillColor(GREY)
    c.drawString(2 * cm, 1.2 * cm, 'Toalhas Express — Manual de uso')
    c.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f'Página {d.page}')
    c.restoreState()


out = '/home/user/Toalhas-Express/docs/treinamento/Manual-Toalhas-Express.pdf'
import os
os.makedirs(os.path.dirname(out), exist_ok=True)
doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=1.8 * cm, bottomMargin=2 * cm,
                        title='Toalhas Express — Manual de uso', author='Toalhas Express')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(out)

/**
 * Templates Meta aprovados do 1º contato FAP01. Os NOMES têm que bater
 * com os templates aprovados no painel da Meta. As funções render*
 * reproduzem o texto exato (variável {{1}} = primeiro nome) para
 * persistir no inbox o que de fato foi enviado.
 */
export const FAP01_TEMPLATES = {
  agendou: 'fap01_1contato_agendou',
  naoAgendou: 'fap01_1contato_nao_agendou',
} as const

export const FAP01_TEMPLATE_LANG = 'pt_BR'

export function renderNaoAgendou(firstName: string): string {
  return (
    `Oi, ${firstName}! Aqui é o Ian, da Negócio Simples. Recebi o seu cadastro e queria te parabenizar pela tomada de decisão.\n\n` +
    `Antes de agendarmos a reunião com Arthur, queria alinhar 2 perguntas com você, pode ser?`
  )
}

/**
 * Renderiza o corpo aprovado de um template Meta ({{1}}, {{2}}, …) com os
 * parâmetros posicionais — pra persistir no inbox o texto que o lead viu.
 */
export function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_m, n) => params[Number(n) - 1] ?? '')
}

export function renderAgendou(firstName: string): string {
  return (
    `Oi, ${firstName}! Aqui é o Ian, da Negócio Simples. Parabéns pela decisão de transformar o seu negócio com automação e IA.\n\n` +
    `Vi que você agendou um diagnóstico com Arthur, posso confirmar 2 informações com você?`
  )
}

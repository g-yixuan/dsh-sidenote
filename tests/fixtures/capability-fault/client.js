// Isolated test plugin at the public client-service boundary. Positive runs
// keep the original facade; fault mode removes one consumed operation only.
window.__ModuleLoader__.load({ id: 'sidenote-e2e-fault', factory: require => {
  const React = require('react')
  let fault = false
  let mainFault = false
  return { inject: ['sessions', 'slots'], apply(ctx) {
    ctx.inject(['conversation'], injected => {
      const hub = injected.get('conversation').input
      const original = hub.for
      hub.for = function (scope) {
        const input = original.call(this, scope)
        const session = ctx.sessions.sessionOf?.(scope) ?? scope.get?.('session')
        const id = session?.sessionId ?? session?.getSnapshot?.().sessionId
        const main = ctx.sessions.list.getSnapshot().current ?? document.querySelector('[data-conversation-session]')?.dataset.conversationSession
        if (!(fault && id !== main) && !(mainFault && id === main)) return input
        if (!id) throw new Error('E2E fault fixture cannot identify the target Session')
        return new Proxy(input, { get(target, key) {
          if (key === 'submit') return undefined
          const value = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        } })
      }
      return () => { hub.for = original }
    })
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
      name: 'conversation.session.header.utilities', id: 'sidenote-e2e-input-fault', order: 99,
    }, () => {
      const [active, setActive] = React.useState(fault)
      const [mainActive, setMainActive] = React.useState(mainFault)
      return React.createElement(React.Fragment, null,
        React.createElement('button', { type: 'button', onClick() { fault = !fault; setActive(fault) } }, active ? 'Restore native input' : 'Simulate missing side input'),
        React.createElement('button', { type: 'button', onClick() { mainFault = !mainFault; setMainActive(mainFault) } }, mainActive ? 'Restore main input' : 'Simulate missing main input'))
    }))
  } }
} })

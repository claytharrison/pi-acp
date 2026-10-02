import test from 'node:test'
import assert from 'node:assert/strict'
import { PiAcpSession, customMessageText } from '../../src/acp/session.js'
import { FakeAgentSideConnection, FakePiRpcProcess, asAgentConn } from '../helpers/fakes.js'

function newSession() {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const session = new PiAcpSession({
    sessionId: 's1',
    cwd: process.cwd(),
    mcpServers: [],
    proc: proc as any,
    conn: asAgentConn(conn),
    fileCommands: []
  })
  return { conn, proc, session }
}

const agentText = (conn: FakeAgentSideConnection) =>
  conn.updates
    .map(u => (u as any).update)
    .filter(u => u?.sessionUpdate === 'agent_message_chunk')
    .map(u => u.content?.text)
    .join('')

test('custom messages with display: true are forwarded as agent text', async () => {
  const { conn, proc, session } = newSession()
  const p = session.prompt('hi')
  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'message_end', message: { role: 'custom', customType: 'x', content: 'Shown **brief**', display: true } } as any)
  proc.emit({ type: 'message_end', message: { role: 'custom', customType: 'y', content: 'hidden', display: false } } as any)
  proc.emit({ type: 'message_end', message: { role: 'custom', customType: 'z', content: [{ type: 'text', text: 'blocks' }], display: true } } as any)
  proc.emit({ type: 'agent_settled' })
  await p
  const text = agentText(conn)
  assert.match(text, /Shown \*\*brief\*\*/)
  assert.match(text, /blocks/)
  assert.doesNotMatch(text, /hidden/)
})

test('an extension command that starts no run ends the ACP turn (no hang)', async () => {
  const { proc, session } = newSession()
  proc.state = { isStreaming: false }
  const p = session.prompt('/brief')
  // pi handled the command and emitted a displayed custom message, but no agent run
  proc.emit({ type: 'message_end', message: { role: 'custom', customType: 'b', content: 'brief', display: true } } as any)
  const reason = await Promise.race([p, new Promise(r => setTimeout(() => r('HUNG'), 3000))])
  assert.equal(reason, 'end_turn')
})

test('a normal prompt is not settled early while pi is streaming', async () => {
  const { proc, session } = newSession()
  proc.state = { isStreaming: true }
  let settled = false
  const p = session.prompt('hello').then(r => {
    settled = true
    return r
  })
  await new Promise(r => setTimeout(r, 600))
  assert.equal(settled, false, 'must wait for agent_settled while streaming')
  proc.emit({ type: 'agent_start' })
  proc.emit({ type: 'agent_settled' })
  assert.equal(await p, 'end_turn')
})

test('customMessageText handles strings and text blocks', () => {
  assert.equal(customMessageText('a'), 'a')
  assert.equal(customMessageText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]), 'a\nb')
  assert.equal(customMessageText(null), '')
})

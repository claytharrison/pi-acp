import test from 'node:test'
import assert from 'node:assert/strict'
import { PiAcpSession } from '../../src/acp/session.js'
import { FakeAgentSideConnection, FakePiRpcProcess, asAgentConn } from '../helpers/fakes.js'

const upd = (proc: FakePiRpcProcess, ame: any) => proc.emit({ type: 'message_update', assistantMessageEvent: ame } as any)

function kinds(conn: FakeAgentSideConnection) {
  // collapse consecutive chunks of the same kind: the sequence of blocks a client would render
  const out: { kind: string; text: string }[] = []
  for (const u of conn.updates.map(x => (x as any).update)) {
    const k = u?.sessionUpdate
    if (k !== 'agent_message_chunk' && k !== 'agent_thought_chunk') continue
    const last = out[out.length - 1]
    if (last && last.kind === k) last.text += u.content.text
    else out.push({ kind: k, text: u.content.text })
  }
  return out
}

test('thinking interleaved into visible text does not split the sentence', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const session = new PiAcpSession({ sessionId: 's', cwd: process.cwd(), mcpServers: [], proc: proc as any, conn: asAgentConn(conn), fileCommands: [] })
  const p = session.prompt('hi')
  proc.emit({ type: 'agent_start' })
  upd(proc, { type: 'start' })
  upd(proc, { type: 'thinking_delta', delta: 'plan first. ' }) // before any text: shown right away
  upd(proc, { type: 'text_delta', delta: 'Let' })
  upd(proc, { type: 'thinking_delta', delta: 'hmm, plate ids' }) // mid-sentence: held
  upd(proc, { type: 'text_delta', delta: ' me confirm those on the plate.' })
  upd(proc, { type: 'done' })
  proc.emit({ type: 'agent_settled' })
  await p
  assert.deepEqual(kinds(conn), [
    { kind: 'agent_thought_chunk', text: 'plan first. ' },
    { kind: 'agent_message_chunk', text: 'Let me confirm those on the plate.' },
    { kind: 'agent_thought_chunk', text: 'hmm, plate ids' }
  ])
})

test('held thinking is released before a tool call', async () => {
  const conn = new FakeAgentSideConnection()
  const proc = new FakePiRpcProcess()
  const session = new PiAcpSession({ sessionId: 's', cwd: process.cwd(), mcpServers: [], proc: proc as any, conn: asAgentConn(conn), fileCommands: [] })
  const p = session.prompt('hi')
  proc.emit({ type: 'agent_start' })
  upd(proc, { type: 'start' })
  upd(proc, { type: 'text_delta', delta: 'Checking.' })
  upd(proc, { type: 'thinking_delta', delta: 'need plate view' })
  upd(proc, { type: 'toolcall_start', contentIndex: 0, partial: { content: [{ type: 'toolCall', id: 't1', name: 'plate', arguments: {} }] } })
  await new Promise(r => setTimeout(r, 50)) // updates go out through an async queue
  const thoughtBeforeTool = conn.updates.map(x => (x as any).update).findIndex(u => u?.sessionUpdate === 'agent_thought_chunk')
  const firstTool = conn.updates.map(x => (x as any).update).findIndex(u => u?.sessionUpdate === 'tool_call')
  assert.ok(thoughtBeforeTool >= 0, 'held thought flushed')
  assert.ok(firstTool === -1 || thoughtBeforeTool < firstTool, 'thought comes before the tool call')
  upd(proc, { type: 'done' })
  proc.emit({ type: 'agent_settled' })
  await p
})

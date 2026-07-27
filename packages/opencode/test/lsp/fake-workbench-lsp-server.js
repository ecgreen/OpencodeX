let buffer = Buffer.alloc(0)
const documents = new Map()

function send(message) {
  const json = JSON.stringify(message)
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`)
}

function response(id, result) {
  send({ jsonrpc: "2.0", id, result })
}

function handle(message) {
  const data = JSON.parse(message)
  if (data.method === "initialize") {
    response(data.id, { capabilities: { textDocumentSync: 1 } })
    return
  }
  if (data.method === "textDocument/didOpen") {
    documents.set(data.params.textDocument.uri, data.params.textDocument.text)
    return
  }
  if (data.method === "textDocument/didChange") {
    documents.set(data.params.textDocument.uri, data.params.contentChanges[0].text)
    return
  }
  if (data.method === "textDocument/hover") {
    response(data.id, {
      contents: {
        kind: "markdown",
        value: documents.get(data.params.textDocument.uri) ?? "",
      },
    })
    return
  }
  if (data.method === "textDocument/definition") {
    response(data.id, {
      uri: data.params.textDocument.uri,
      range: { start: data.params.position, end: data.params.position },
    })
    return
  }
  if (data.method === "textDocument/completion") {
    response(data.id, {
      isIncomplete: false,
      items: [
        {
          label: "workbenchCompletion",
          detail: documents.get(data.params.textDocument.uri) ?? "",
          data: data.params.context ?? null,
        },
      ],
    })
    return
  }
  if (typeof data.id !== "undefined") response(data.id, null)
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n")
    if (headerEnd === -1) return
    const match = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString("utf8"))
    const length = Number(match?.[1] ?? 0)
    const bodyStart = headerEnd + 4
    if (buffer.length < bodyStart + length) return
    handle(buffer.subarray(bodyStart, bodyStart + length).toString("utf8"))
    buffer = buffer.subarray(bodyStart + length)
  }
})

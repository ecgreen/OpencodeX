import * as vscode from "vscode"

const TERMINAL_NAME = "OpencodeX"
const PORT_ENV = "_EXTENSION_OPENCODEX_PORT"

export function activate(context: vscode.ExtensionContext) {
  const openNewTerminalDisposable = vscode.commands.registerCommand("opencodex.openNewTerminal", async () => {
    await openTerminal()
  })

  const openTerminalDisposable = vscode.commands.registerCommand("opencodex.openTerminal", async () => {
    const existingTerminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
    if (existingTerminal) {
      existingTerminal.show()
      return
    }

    await openTerminal()
  })

  const addFilepathDisposable = vscode.commands.registerCommand("opencodex.addFilepathToTerminal", async () => {
    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    const terminal = vscode.window.activeTerminal
    if (!terminal) {
      return
    }

    if (terminal.name === TERMINAL_NAME) {
      const port = getTerminalPort(terminal)
      port ? await appendPrompt(Number(port), fileRef) : terminal.sendText(fileRef, false)
      terminal.show()
    }
  })

  context.subscriptions.push(openNewTerminalDisposable, openTerminalDisposable, addFilepathDisposable)

  async function openTerminal() {
    const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      iconPath: {
        light: vscode.Uri.file(context.asAbsolutePath("images/button-light.png")),
        dark: vscode.Uri.file(context.asAbsolutePath("images/button-dark.png")),
      },
      location: {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false,
      },
      env: {
        [PORT_ENV]: port.toString(),
        OPENCODE_CALLER: "vscode",
        OPENCODEX_CALLER: "vscode",
      },
    })

    terminal.show()
    terminal.sendText(launchCommand(port))

    const fileRef = shouldAutoAttachCurrentFile() ? getActiveFile() : undefined
    if (!fileRef) {
      return
    }

    if (await waitForTui(port)) {
      await appendPrompt(port, `In ${fileRef}`)
      terminal.show()
    }
  }

  async function appendPrompt(port: number, text: string) {
    await fetch(`http://localhost:${port}/tui/append-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    })
  }

  function getActiveFile() {
    const activeEditor = vscode.window.activeTextEditor
    if (!activeEditor) {
      return
    }

    const document = activeEditor.document
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (!workspaceFolder) {
      return
    }

    // Get the relative path from workspace root
    const relativePath = vscode.workspace.asRelativePath(document.uri)
    let filepathWithAt = `@${relativePath}`

    // Check if there's a selection and add line numbers
    const selection = activeEditor.selection
    if (!selection.isEmpty) {
      // Convert to 1-based line numbers
      const startLine = selection.start.line + 1
      const endLine = selection.end.line + 1

      if (startLine === endLine) {
        // Single line selection
        filepathWithAt += `#L${startLine}`
      } else {
        // Multi-line selection
        filepathWithAt += `#L${startLine}-${endLine}`
      }
    }

    return filepathWithAt
  }
}

export function deactivate() {}

function getTerminalPort(terminal: vscode.Terminal) {
  const creationOptions = terminal.creationOptions
  if (!creationOptions || !("env" in creationOptions)) {
    return
  }
  return creationOptions.env?.[PORT_ENV] ?? undefined
}

function launchCommand(port: number) {
  const config = vscode.workspace.getConfiguration("opencodex")
  const command = config.get("command", "opencodex").trim() || "opencodex"
  const args = config.get<string[]>("arguments", [])
  return [command, ...args.map(shellArg), "--port", port.toString()].join(" ")
}

function shouldAutoAttachCurrentFile() {
  return vscode.workspace.getConfiguration("opencodex").get("autoAttachCurrentFile", true)
}

async function waitForTui(port: number) {
  const attempts = Array.from({ length: 10 })
  for (const _ of attempts) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    try {
      await fetch(`http://localhost:${port}/app`)
      return true
    } catch {}
  }
  return false
}

function shellArg(value: string) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value
  }
  return `"${value.replaceAll('"', '\\"')}"`
}

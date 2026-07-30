import { Show } from "solid-js"
import type { GuiAppModel } from "../controllers/app-model"
import { shouldShowConnectionWarning } from "../lib/connection-warning"
import { Button } from "./ui"

/**
 * Stage-level notices that sit above the routed content: the reconnect warning
 * and the backend update offer. Extracted from `app-shell.tsx` so that file
 * stays inside the design-system size budget.
 */
export function AppShellBanners(props: { model: GuiAppModel }) {
  const model = props.model
  return (
    <>
      <Show when={shouldShowConnectionWarning(model.authoritative.state()?.lifecycle)}>
        <div class="sync-status-banner" role="status" aria-live="polite">
          <span>
            <strong>Connection interrupted.</strong> Showing the last authoritative state while OpencodeX reconnects.
          </span>
          <Button appearance="outline" type="button" onClick={() => void model.notices.run(model.authoritative.retry)}>
            Retry now
          </Button>
        </div>
      </Show>
      <Show when={model.updateNotice.visible() ? model.updateNotice.notice() : undefined}>
        {(notice) => (
          <div class="sync-status-banner" role="status" aria-live="polite">
            <span>
              <strong>Update available.</strong> OpencodeX v{notice().version} is ready to install.
            </span>
            <Button
              appearance="solid"
              tone="accent"
              type="button"
              disabled={model.updateNotice.upgrading()}
              onClick={() => void model.updateNotice.upgrade()}
            >
              {model.updateNotice.upgrading() ? "Updating..." : "Update"}
            </Button>
            <Button appearance="ghost" type="button" onClick={model.updateNotice.skip}>
              Skip
            </Button>
          </div>
        )}
      </Show>
    </>
  )
}

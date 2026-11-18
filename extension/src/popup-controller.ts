// The popup's entry point. Each action is handled in its own module:
// popup-session (sign in, unlock, approval), popup-fill, and popup-save.
// popup-state holds the secrets and the shared screens.

import { cancelSave, saveLogin, startSave } from "./popup-save"
import { fill, search } from "./popup-fill"
import { lock, signIn, signOut, start, unlock } from "./popup-session"
import {
  PopupState,
  type PopupControllerOptions,
  type PopupView,
  type SaveDraft,
} from "./popup-state"

export type {
  CurrentTab,
  FillLogin,
  Notice,
  PopupControllerOptions,
  PopupView,
  SaveDraft,
  Send,
  VaultEntry,
} from "./popup-state"

export class PopupController {
  private readonly state: PopupState

  constructor(options: PopupControllerOptions) {
    this.state = new PopupState(options)
  }

  get current(): PopupView {
    return this.state.view
  }

  start(): Promise<void> {
    return start(this.state)
  }

  signIn(email: string, password: string): Promise<void> {
    return signIn(this.state, email, password)
  }

  unlock(password: string): Promise<void> {
    return unlock(this.state, password)
  }

  signOut(): Promise<void> {
    return signOut(this.state)
  }

  search(query: string): void {
    search(this.state, query)
  }

  fill(id: string): Promise<void> {
    return fill(this.state, id)
  }

  startSave(): Promise<void> {
    return startSave(this.state)
  }

  cancelSave(): void {
    cancelSave(this.state)
  }

  saveLogin(draft: SaveDraft): Promise<void> {
    return saveLogin(this.state, draft)
  }

  lock(): void {
    lock(this.state)
  }

  /** Forgets every secret, for example when the popup closes. */
  dispose(): void {
    this.state.reset()
  }
}

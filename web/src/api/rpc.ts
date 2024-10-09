// gomuks - A Matrix client written in Go.
// Copyright (C) 2024 Tulir Asokan
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
import { CachedEventDispatcher, EventDispatcher } from "../util/eventdispatcher.ts"
import { CancellablePromise } from "../util/promise.ts"
import type {
	ClientWellKnown,
	DBEvent,
	EventID,
	EventRowID,
	EventType,
	PaginationResponse,
	RoomID,
	TimelineRowID, UserID,
} from "./types/hitypes.ts"
import { RPCCommand, RPCEvent } from "./types/hievents.ts"

export interface ConnectionEvent {
	connected: boolean
	error: Error | null
}

export class ErrorResponse extends Error {
	constructor(public data: unknown) {
		super(`${data}`)
	}
}

export default abstract class RPCClient {
	public readonly connect: CachedEventDispatcher<ConnectionEvent> = new CachedEventDispatcher()
	public readonly event: EventDispatcher<RPCEvent> = new EventDispatcher()
	protected readonly pendingRequests: Map<number, {
		resolve: (data: unknown) => void,
		reject: (err: Error) => void
	}> = new Map()
	protected nextRequestID: number = 1

	protected abstract isConnected: boolean
	protected abstract send(data: string): void
	public abstract start(): void
	public abstract stop(): void

	protected onCommand(data: RPCCommand<unknown>) {
		if (data.command === "response" || data.command === "error") {
			const target = this.pendingRequests.get(data.request_id)
			if (!target) {
				console.error("Received response for unknown request:", data)
				return
			}
			this.pendingRequests.delete(data.request_id)
			if (data.command === "response") {
				target.resolve(data.data)
			} else {
				target.reject(new ErrorResponse(data.data))
			}
		} else {
			this.event.emit(data as RPCEvent)
		}
	}

	protected cancelRequest(request_id: number, reason: string) {
		if (!this.pendingRequests.has(request_id)) {
			console.debug("Tried to cancel unknown request", request_id)
			return
		}
		this.request("cancel", { request_id, reason }).then(
			() => console.debug("Cancelled request", request_id, "for", reason),
			err => console.debug("Failed to cancel request", request_id, "for", reason, err),
		)
	}

	request<Req, Resp>(command: string, data: Req): CancellablePromise<Resp> {
		if (!this.isConnected) {
			return new CancellablePromise((_resolve, reject) => {
				reject(new Error("Websocket not connected"))
			}, () => {
			})
		}
		const request_id = this.nextRequestID++
		return new CancellablePromise((resolve, reject) => {
			if (!this.isConnected) {
				reject(new Error("Websocket not connected"))
				return
			}
			this.pendingRequests.set(request_id, { resolve: resolve as ((value: unknown) => void), reject })
			this.send(JSON.stringify({
				command,
				request_id,
				data,
			}))
		}, this.cancelRequest.bind(this, request_id))
	}

	sendMessage(room_id: RoomID, type: EventType, content: Record<string, unknown>): Promise<DBEvent> {
		return this.request("send_message", { room_id, type, content })
	}

	ensureGroupSessionShared(room_id: RoomID): Promise<boolean> {
		return this.request("ensure_group_session_shared", { room_id })
	}

	getRoomState(room_id: RoomID, fetch_members = false, refetch = false): Promise<DBEvent[]> {
		return this.request("get_room_state", { room_id, fetch_members, refetch })
	}

	getEvent(room_id: RoomID, event_id: EventID): Promise<DBEvent> {
		return this.request("get_event", { room_id, event_id })
	}

	getEventsByRowIDs(row_ids: EventRowID[]): Promise<DBEvent[]> {
		return this.request("get_events_by_row_ids", { row_ids })
	}

	paginate(room_id: RoomID, max_timeline_id: TimelineRowID, limit: number): Promise<PaginationResponse> {
		return this.request("paginate", { room_id, max_timeline_id, limit })
	}

	paginateServer(room_id: RoomID, limit: number): Promise<PaginationResponse> {
		return this.request("paginate_server", { room_id, limit })
	}

	discoverHomeserver(user_id: UserID): Promise<ClientWellKnown> {
		return this.request("discover_homeserver", { user_id })
	}

	login(homeserver_url: string, username: string, password: string): Promise<boolean> {
		return this.request("login", { homeserver_url, username, password })
	}

	verify(recovery_key: string): Promise<boolean> {
		return this.request("verify", { recovery_key })
	}
}
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
import { use, useCallback, useLayoutEffect, useState } from "react"
import type { RoomID } from "@/api/types"
import ClientContext from "./ClientContext.ts"
import RoomView from "./RoomView.tsx"
import RoomList from "./roomlist/RoomList.tsx"
import "./MainScreen.css"

const MainScreen = () => {
	const [activeRoomID, setActiveRoomID] = useState<RoomID | null>(null)
	const client = use(ClientContext)!
	const activeRoom = activeRoomID && client.store.rooms.get(activeRoomID)
	const setActiveRoom = useCallback((roomID: RoomID) => {
		console.log("Switching to room", roomID)
		setActiveRoomID(roomID)
		if (client.store.rooms.get(roomID)?.stateLoaded === false) {
			client.loadRoomState(roomID)
				.catch(err => console.error("Failed to load room state", err))
		}
	}, [client])
	useLayoutEffect(() => {
		client.store.switchRoom = setActiveRoom
	}, [client, setActiveRoom])
	const clearActiveRoom = useCallback(() => setActiveRoomID(null), [])
	return <main className={`matrix-main ${activeRoom ? "room-selected" : ""}`}>
		<RoomList setActiveRoom={setActiveRoom} activeRoomID={activeRoomID} />
		{activeRoom && <RoomView key={activeRoomID} clearActiveRoom={clearActiveRoom} room={activeRoom} />}
	</main>
}

export default MainScreen

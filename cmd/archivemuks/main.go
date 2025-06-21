// gomuks - A Matrix client written in Go.
// Copyright (C) 2025 Tulir Asokan
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

package main

import (
	"context"
	"fmt"
	"maps"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"go.mau.fi/util/exerrors"
	"go.mau.fi/util/exsync"
	"go.mau.fi/util/exzerolog"
	"go.mau.fi/util/ptr"
	"go.mau.fi/zeroconfig"
	flag "maunium.net/go/mauflag"
	"maunium.net/go/mautrix/id"

	"go.mau.fi/gomuks/pkg/hicli/database"
	"go.mau.fi/gomuks/pkg/hicli/jsoncmd"
	"go.mau.fi/gomuks/pkg/rpc"
)

var address = flag.MakeFull("a", "address", "Address to use to connect to the backend", "http://localhost:29325").String()
var username = flag.MakeFull("u", "username", "Username for the backend", "").String()
var password = flag.MakeFull("p", "password", "Password for the backend", "").String()
var roomToFetch = flag.MakeFull("r", "room", "Room ID to fetch messages from", "").String()
var maxMessages = flag.MakeFull("m", "max-messages", "Maximum number of messages to fetch from the room", "0").Int()
var oldestEvent = flag.MakeFull("e", "oldest-event", "Oldest event ID to fetch from the room", "").String()

var cli *rpc.GomuksRPC
var initComplete = exsync.NewEvent()
var roomMeta = make(map[id.RoomID]*database.Room)
var spaceEdges = make(map[id.RoomID][]*database.SpaceEdge)

func main() {
	exerrors.PanicIfNotNil(flag.Parse())
	log := exerrors.Must((&zeroconfig.Config{
		Writers: []zeroconfig.WriterConfig{{
			Type:   zeroconfig.WriterTypeStdout,
			Format: zeroconfig.LogFormatPrettyColored,
		}},
		MinLevel: ptr.Ptr(zerolog.TraceLevel),
	}).Compile())
	exzerolog.SetupDefaults(log)
	ctx := log.WithContext(context.Background())

	cli = exerrors.Must(rpc.NewGomuksRPC(*address))
	cli.EventHandler = handleEvent
	exerrors.PanicIfNotNil(cli.Authenticate(ctx, *username, *password))
	exerrors.PanicIfNotNil(cli.Connect(ctx))

	_ = initComplete.Wait(ctx)

	taskCtx, cancel := context.WithCancel(ctx)
	paginationDone := make(chan struct{})
	if *roomToFetch != "" {
		go paginateRoom(taskCtx, id.RoomID(*roomToFetch), *maxMessages, id.EventID(*oldestEvent), paginationDone)
	}

	go func() {
		timer := time.NewTimer(10 * time.Second)
		defer timer.Stop()
		select {
		case <-taskCtx.Done():
			return
		case <-timer.C:
			_, _ = cli.Ping(ctx, &jsoncmd.PingParams{LastReceivedID: cli.LastReqID})
		}
	}()

	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	select {
	case <-c:
	case <-taskCtx.Done():
	}
	cli.Disconnect()
	cancel()
}

func handleEvent(ctx context.Context, rawEvt any) {
	switch evt := rawEvt.(type) {
	case *jsoncmd.SyncComplete:
		//fmt.Println("Sync with", len(evt.Rooms), "rooms")
		for _, room := range evt.Rooms {
			roomMeta[room.Meta.ID] = room.Meta
		}
		maps.Copy(spaceEdges, evt.SpaceEdges)
	case *jsoncmd.InitComplete:
		fmt.Println("Init complete")
		initComplete.Set()
	case *jsoncmd.EventsDecrypted:
		fmt.Println(len(evt.Events), "events in", evt.RoomID, "were decrypted")
	case *jsoncmd.Typing:
	default:
		fmt.Printf("Unknown event %T %+v\n", evt, evt)
	}
}

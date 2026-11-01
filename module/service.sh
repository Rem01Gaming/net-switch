#!/bin/sh
# Modified: apply through the same backend as the CLI and WebUI.
# Wait until boot completed
until [ "$(getprop sys.boot_completed)" = "1" ]; do
	sleep 1
done

MODDIR=${0%/*}
sh "$MODDIR/system/bin/netswitch" apply >>/dev/kmsg 2>&1

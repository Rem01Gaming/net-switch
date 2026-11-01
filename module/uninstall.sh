#!/bin/sh
# Modified: remove only rules owned by the shared backend.

MODDIR=${0%/*}
sh "$MODDIR/system/bin/netswitch" clear || exit 1

# remove configs
rm -rf /data/adb/net-switch

# clean our symlinks
rm /data/adb/ap/bin/netswitch
rm /data/adb/ksu/bin/netswitch

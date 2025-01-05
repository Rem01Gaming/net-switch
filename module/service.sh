#!/bin/sh
# Wait until boot completed
until [ "$(getprop sys.boot_completed)" = "1" ] && [ -f /data/system/packages.list ]; do
	sleep 1
done

packages="$( sed 's|[]\"[]||g; s|,| |g' /data/adb/net-switch/isolated.json )"
for apk in $packages; do
	uid="$(grep $apk /data/system/packages.list | awk '{print $2; exit}')"
	[ ! -z $uid ] && {
		iptables -I OUTPUT -m owner --uid-owner $uid -j REJECT
		ip6tables -I OUTPUT -m owner --uid-owner $uid -j REJECT
		# debug
		echo "net-switch: blocked $apk with uid: $uid" >> /dev/kmsg
		}
done

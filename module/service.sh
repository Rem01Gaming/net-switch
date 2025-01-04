# Wait until boot completed
until [ "$(getprop sys.boot_completed)" = "1" ] && [ -f /data/system/packages.list ]; do
	sleep 1
done

packages="$(cat /data/adb/net-switch/isolated.json | tr -d '[]" ' | tr ',' ' ')"
for apk in $packages; do
	uid="$(grep $apk /data/system/packages.list | awk '{print $2; exit}')"
	[ -z $uid ] && continue
	iptables -I OUTPUT -m owner --uid-owner $uid -j REJECT
	ip6tables -I OUTPUT -m owner --uid-owner $uid -j REJECT
done

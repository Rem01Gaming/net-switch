# Wait until boot completed
until [ "$(getprop sys.boot_completed)" = "1" ]; do
	sleep 1
done

packages="$(cat /data/adb/net-switch/isolated.json | tr -d '[]" ' | tr ',' ' ')"
for apk in $packages; do
	loop=1
	until [ -d /data/data/$apk ]; do
		((loop++))
		[ $loop -eq 20 ] && break
		sleep 3
	done

	uid="$(stat -c '%u' /data/data/$apk)"
	iptables -I OUTPUT -m owner --uid-owner $uid -j REJECT
	ip6tables -I OUTPUT -m owner --uid-owner $uid -j REJECT
done

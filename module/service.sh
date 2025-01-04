# Wait until boot completed
until [ "$(getprop sys.boot_completed)" = "1" ] && [ -d /data/data ]; do
    sleep 1
done

packages="$(cat /data/adb/net-switch/isolated.json | tr -d '[]" ' | tr ',' ' ')"
for apk in $packages; do
	uid="$(stat -c '%u' /data/data/$apk)"
	iptables -I OUTPUT -m owner --uid-owner $uid -j REJECT
	ip6tables -I OUTPUT -m owner --uid-owner $uid -j REJECT
done

# Wait until boot completed
while [ -z "$(getprop sys.boot_completed)" ]; do
	sleep 40
done

packages="$(cat /data/adb/net-switch/isolated.json | tr -d '[]" ' | tr ',' ' ')"
for apk in $packages; do
	uid="$(stat -c '%u' /data/data/$apk)"
	iptables -I OUTPUT -m owner --uid-owner $uid -j REJECT
	ip6tables -I OUTPUT -m owner --uid-owner $uid -j REJECT
done

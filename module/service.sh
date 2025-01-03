# Wait until boot completed
while [ -z "$(getprop sys.boot_completed)" ]; do
	sleep 40
done

packages="$(cat /data/adb/net-switch/isolated.json | tr -d '[]" ' | tr ',' ' ')"
for apk in $packages; do
	uid="$(dumpsys package $apk 2>/dev/null | awk -F'=' '/userId=/ {print $2; exit}')"
	iptables -I OUTPUT -m owner --uid-owner $uid -j DROP
	iptables -I INPUT -m owner --uid-owner $uid -j DROP
done

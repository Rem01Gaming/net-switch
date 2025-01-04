ISOLATED="/data/adb/net-switch/isolated.json"
if [ ! -f $ISOLATED ]; then
	mkdir $(dirname $ISOLATED)
	touch $ISOLATED
fi

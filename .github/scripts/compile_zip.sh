#!/bin/env bash

if [ -z $GITHUB_WORKSPACE ]; then
	echo "This script should only run on GitHub action!" >&2
	exit 1
fi

# Make sure we're on right directory
cd $GITHUB_WORKSPACE

# Version info
version="$(cat version)"
version_code="$(git rev-list HEAD --count)"
release_code="$(git rev-list HEAD --count)-$(git rev-parse --short HEAD)-release"
sed -i "s/version=.*/version=$version ($release_code)/" module/module.prop
sed -i "s/versionCode=.*/versionCode=$version_code/" module/module.prop

# Compile Gamelist
bash gamelist_compile.sh

# Copy module files
cp -r ./src/libs module
cp -r ./src/scripts/* module/system/bin
cp LICENSE ./module

# Parse version info to module prop
zipName="net-switch-$version-$release_code.zip"
echo "zipName=$zipName" >>$GITHUB_OUTPUT

# Zip the file
cd ./module
zip -r9 ../$zipName * -x *gitkeep* *.map
zip -z ../$zipName <<EOF
$version-$release_code
Build Date $(date +"%a %b %d %H:%M:%S %Z %Y")
EOF

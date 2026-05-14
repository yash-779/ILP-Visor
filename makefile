# If PIN_ROOT is not set, default to a downloaded version in the project dir
PIN_ROOT ?= $(shell pwd)/pin
CONFIG_ROOT := $(PIN_ROOT)/source/tools/Config

include $(CONFIG_ROOT)/makefile.config
include $(TOOLS_ROOT)/Config/makefile.default.rules

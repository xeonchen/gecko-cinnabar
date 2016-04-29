/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_dom_TVDaemonHelpers_h
#define mozilla_dom_TVDaemonHelpers_h

#define OPCODE_NTF_FILTER 0x80

namespace mozilla {
namespace dom {

enum class TVStatus : uint8_t {
  STATUS_OK = 0x00,
  STATUS_FAILURE = 0x01,
  STATUS_INVALID_ARG = 0x02,
  STATUS_NO_SIGNAL = 0x03,
  STATUS_NOT_SUPPORTED = 0x04
};

nsresult
Convert(nsresult aIn, TVStatus& aOut);

} // namespace dom
} // namespace mozilla

#endif

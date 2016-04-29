/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "TVHelpers.h"

namespace mozilla {
namespace dom {

nsresult
Convert(nsresult aIn, TVStatus& aOut)
{
  if (NS_SUCCEEDED(aIn)) {
    aOut = TVStatus::STATUS_OK;
  } else if (aIn == NS_ERROR_INVALID_ARG) {
    aOut = TVStatus::STATUS_INVALID_ARG;
  } else if (aIn == NS_ERROR_NOT_AVAILABLE) {
    aOut = TVStatus::STATUS_NO_SIGNAL;
  } else if (aIn == NS_ERROR_NOT_IMPLEMENTED) {
    aOut = TVStatus::STATUS_NOT_SUPPORTED;
  } else {
    aOut = TVStatus::STATUS_FAILURE;
  }

  return NS_OK;
}

} // namespace dom
} // namespace mozilla

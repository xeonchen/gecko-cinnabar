/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "TVGonkService.h"

#include "mozilla/dom/TVServiceRunnables.h"
#include "nsCOMPtr.h"
#include "nsIMutableArray.h"
#include "nsServiceManagerUtils.h"
#include "TVDaemonInterface.h"

namespace mozilla {
namespace dom {

class DisconnectResultHandler final : public TVDaemonResultHandler
{
public:
  DisconnectResultHandler(TVDaemonInterface* aInterface)
    : mInterface(aInterface)
  {
    MOZ_ASSERT(aInterface);
  }

  void OnError(TVStatus aError)
  {
    MOZ_ASSERT(mInterface);

    TVDaemonResultHandler::OnError(aError);
    if (!mInterface) {
      return;
    }
    mInterface->SetNotificationHandler(nullptr);
  }

  void Disconnect() override
  {
    MOZ_ASSERT(mInterface);

    if (!mInterface) {
      return;
    }
    mInterface->SetNotificationHandler(nullptr);
  }

private:
  TVDaemonInterface* mInterface;
};

/**
 * |TVRegisterModuleResultHandler| implements the result-handler
 * callback for registering the services. If an error occures
 * during the process, the result handler
 * disconnects and closes the backend.
 */
class TVRegisterModuleResultHandler final : public RegistryResultHandler
{
public:
  TVRegisterModuleResultHandler(TVDaemonInterface* aInterface)
    : mInterface(aInterface)
  {
    MOZ_ASSERT(aInterface);
  }

  void OnError(TVStatus aError) override
  {
    RegistryResultHandler::OnError(aError);
    Disconnect(); // Registering failed, so close the connection completely
  }

  void RegisterModule() override
  {
    // TODO
  }

  void Disconnect()
  {
    MOZ_ASSERT(mInterface);
    mInterface->Disconnect(new DisconnectResultHandler(mInterface));
  }

private:
  TVDaemonInterface* mInterface;
};

/**
 * |TVConnectResultHandler| implements the result-handler
 * callback for starting the TV backend.
 */
class TVConnectResultHandler final : public TVDaemonResultHandler
{
public:
  TVConnectResultHandler(TVDaemonInterface* aInterface) : mInterface(aInterface)
  {
    MOZ_ASSERT(aInterface);
  }

  void OnError(TVStatus aError) override
  {
    MOZ_ASSERT(mInterface);

    TVDaemonResultHandler::OnError(aError);
    mInterface->SetNotificationHandler(nullptr);
  }

  void Connect() override
  {
    MOZ_ASSERT(NS_IsMainThread());
    // TODO Register service here.
  }

private:
  TVDaemonInterface* mInterface;
};

/**
 * This is the notifiaction handler for the TV interface. If the backend
 * crashes, we can restart it from here.
 */
class TVNotificationHandler final : public TVDaemonNotificationHandler
{
public:
  TVNotificationHandler(TVDaemonInterface* aInterface) : mInterface(aInterface)
  {
    MOZ_ASSERT(mInterface);
    mInterface->SetNotificationHandler(this);
  }

  void BackendErrorNotification(bool aCrashed) override
  {
    MOZ_ASSERT(mInterface);

    // Force the TV daemon interface to init.
    // Start up
    // Init, step 1: connect to TV backend
    mInterface->Connect(this, new TVConnectResultHandler(mInterface));
  }

private:
  TVDaemonInterface* mInterface;
};

NS_IMPL_ISUPPORTS(TVGonkService, nsITVService)

TVGonkService::TVGonkService()
{
  mInterface = TVDaemonInterface::GetInstance();

  if (!mInterface) {
    return;
  }

  // Force the TV daemon interface to init.
  // Start up
  // Init, step 1: connect to TV backend
  mInterface->Connect(new TVNotificationHandler(mInterface),
                      new TVConnectResultHandler(mInterface));
}

TVGonkService::~TVGonkService()
{
  if (!mInterface) {
    return;
  }
  mInterface->Disconnect(new DisconnectResultHandler(mInterface));
}

NS_IMETHODIMP
TVGonkService::RegisterSourceListener(const nsAString& aTunerId,
                                      const nsAString& aSourceType,
                                      nsITVSourceListener* aListener)
{
  MOZ_ASSERT(NS_IsMainThread());
  MOZ_ASSERT(!aTunerId.IsEmpty());
  MOZ_ASSERT(!aSourceType.IsEmpty());
  MOZ_ASSERT(aListener);

  mSourceListenerTuples.AppendElement(MakeUnique<TVSourceListenerTuple>(
    nsString(aTunerId), nsString(aSourceType), aListener));
  return NS_OK;
}

NS_IMETHODIMP
TVGonkService::UnregisterSourceListener(const nsAString& aTunerId,
                                        const nsAString& aSourceType,
                                        nsITVSourceListener* aListener)
{
  MOZ_ASSERT(NS_IsMainThread());
  MOZ_ASSERT(!aTunerId.IsEmpty());
  MOZ_ASSERT(!aSourceType.IsEmpty());
  MOZ_ASSERT(aListener);

  for (uint32_t i = 0; i < mSourceListenerTuples.Length(); i++) {
    const UniquePtr<TVSourceListenerTuple>& tuple = mSourceListenerTuples[i];
    if (aTunerId.Equals(Get<0>(*tuple)) && aSourceType.Equals(Get<1>(*tuple)) &&
        aListener == Get<2>(*tuple)) {
      mSourceListenerTuples.RemoveElementAt(i);
      break;
    }
  }

  return NS_OK;
}

void
TVGonkService::GetSourceListeners(
  const nsAString& aTunerId, const nsAString& aSourceType,
  nsTArray<nsCOMPtr<nsITVSourceListener>>& aListeners) const
{
  aListeners.Clear();

  for (uint32_t i = 0; i < mSourceListenerTuples.Length(); i++) {
    const UniquePtr<TVSourceListenerTuple>& tuple = mSourceListenerTuples[i];
    nsCOMPtr<nsITVSourceListener> listener = Get<2>(*tuple);
    if (aTunerId.Equals(Get<0>(*tuple)) && aSourceType.Equals(Get<1>(*tuple))) {
      aListeners.AppendElement(listener);
      break;
    }
  }
}

/* virtual */ NS_IMETHODIMP
TVGonkService::GetTuners(nsITVServiceCallback* aCallback)
{
  MOZ_ASSERT(aCallback);

  // TODO Bug 1229308 - Communicate with TV daemon process.

  return NS_OK;
}

/* virtual */ NS_IMETHODIMP
TVGonkService::SetSource(const nsAString& aTunerId,
                         const nsAString& aSourceType,
                         nsITVServiceCallback* aCallback)
{
  MOZ_ASSERT(!aTunerId.IsEmpty());
  MOZ_ASSERT(!aSourceType.IsEmpty());
  MOZ_ASSERT(aCallback);

  // TODO Bug 1229308 - Communicate with TV daemon process.

  return NS_OK;
}

/* virtual */ NS_IMETHODIMP
TVGonkService::StartScanningChannels(const nsAString& aTunerId,
                                     const nsAString& aSourceType,
                                     nsITVServiceCallback* aCallback)
{
  MOZ_ASSERT(!aTunerId.IsEmpty());
  MOZ_ASSERT(!aSourceType.IsEmpty());
  MOZ_ASSERT(aCallback);

  // TODO Bug 1229308 - Communicate with TV daemon process.

  return NS_OK;
}

/* virtual */ NS_IMETHODIMP
TVGonkService::StopScanningChannels(const nsAString& aTunerId,
                                    const nsAString& aSourceType,
                                    nsITVServiceCallback* aCallback)
{
  MOZ_ASSERT(!aTunerId.IsEmpty());
  MOZ_ASSERT(!aSourceType.IsEmpty());
  MOZ_ASSERT(aCallback);

  // TODO Bug 1229308 - Communicate with TV daemon process.

  return NS_OK;
}

/* virtual */ NS_IMETHODIMP
TVGonkService::ClearScannedChannelsCache()
{
  // TODO Bug 1229308 - Communicate with TV daemon process.

  return NS_OK;
}

/* virtual */ NS_IMETHODIMP
TVGonkService::SetChannel(const nsAString& aTunerId,
                          const nsAString& aSourceType,
                          const nsAString& aChannelNumber,
                          nsITVServiceCallback* aCallback)
{
  MOZ_ASSERT(!aTunerId.IsEmpty());
  MOZ_ASSERT(!aSourceType.IsEmpty());
  MOZ_ASSERT(aCallback);

  // TODO Bug 1229308 - Communicate with TV daemon process.

  return NS_OK;
}

/* virtual */ NS_IMETHODIMP
TVGonkService::GetChannels(const nsAString& aTunerId,
                           const nsAString& aSourceType,
                           nsITVServiceCallback* aCallback)
{
  MOZ_ASSERT(!aTunerId.IsEmpty());
  MOZ_ASSERT(!aSourceType.IsEmpty());
  MOZ_ASSERT(aCallback);

  // TODO Bug 1229308 - Communicate with TV daemon process.

  return NS_OK;
}

/* virtual */ NS_IMETHODIMP
TVGonkService::GetPrograms(const nsAString& aTunerId,
                           const nsAString& aSourceType,
                           const nsAString& aChannelNumber, uint64_t startTime,
                           uint64_t endTime, nsITVServiceCallback* aCallback)
{
  MOZ_ASSERT(!aTunerId.IsEmpty());
  MOZ_ASSERT(!aSourceType.IsEmpty());
  MOZ_ASSERT(!aChannelNumber.IsEmpty());
  MOZ_ASSERT(aCallback);

  // TODO Bug 1229308 - Communicate with TV daemon process.

  return NS_OK;
}

} // namespace dom
} // namespace mozilla

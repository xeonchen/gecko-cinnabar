/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "AvahiOperator.h"
#include <avahi-common/error.h>
#include <avahi-common/malloc.h>
#include <avahi-common/thread-watch.h>
#include "mozilla/Logging.h"
#include "mozilla/ScopeExit.h"
#include "mozilla/UniquePtr.h"
#include "nsThreadUtils.h"

namespace mozilla {
namespace net {

static LazyLogModule gAvahiLog("AvahiOperator");
#undef LOG_I
#define LOG_I(...) MOZ_LOG(mozilla::net::gAvahiLog, mozilla::LogLevel::Debug, (__VA_ARGS__))
#undef LOG_E
#define LOG_E(...) MOZ_LOG(mozilla::net::gAvahiLog, mozilla::LogLevel::Error, (__VA_ARGS__))

class AvahiOperator::AvahiInternal final
{
  NS_INLINE_DECL_THREADSAFE_REFCOUNTING(AvahiOperator)

public:
  AvahiInternal()
    : mAvahiPoll(nullptr, nullptr)
    , mAvahiClient(nullptr, nullptr)
    , mAvahiBrowser(nullptr, nullptr)
  {
  }

  nsresult
  Init()
  {
    auto guard = MakeScopeExit([this] {
      NS_WARN_IF(NS_FAILED(Close()));
    });

    mAvahiPoll = AvahiThreadedPollPtr(avahi_threaded_poll_new(),
                                      avahi_threaded_poll_free);

    if (NS_WARN_IF(!mAvahiPoll)) {
      LOG_E("avahi_threaded_poll_new error");
      return NS_ERROR_FAILURE;
    }

    int error;
    mAvahiClient = AvahiClientPtr(
      avahi_client_new(avahi_threaded_poll_get(mAvahiPoll.get()),
                       static_cast<AvahiClientFlags>(0),
                       &AvahiInternal::ClientCallback,
                       this,
                       &error),
      avahi_client_free);

    if (NS_WARN_IF(!mAvahiClient)) {
      LOG_E("avahi_client_new error: %s", avahi_strerror(error));
      return NS_ERROR_FAILURE;
    }

    avahi_threaded_poll_start(mAvahiPoll.get());

    guard.release();
    return NS_OK;
  }

  nsresult
  Close()
  {
    mAvahiBrowser.reset();
    mAvahiClient.reset();

    if (mAvahiPoll) {
      avahi_threaded_poll_stop(mAvahiPoll.get());
      mAvahiPoll.reset();
    }

    return NS_OK;
  }

  static void
  ClientCallback(AvahiClient* aClient,
                 AvahiClientState aState,
                 void* aUserData)
  {
    AvahiInternal* avahi = static_cast<AvahiInternal*>(aUserData);
    MOZ_ASSERT(avahi);

    NS_DispatchToMainThread(
      NS_NewRunnableMethodWithArgs<AvahiClient*,
                                   AvahiClientState>(avahi,
                                                     &AvahiInternal::ClientReply,
                                                     aClient,
                                                     aState));
  }

  void
  ClientReply(AvahiClient* aClient,
        AvahiClientState aState)
  {
    MOZ_ASSERT(NS_IsMainThread());

    switch (aState) {

      case AVAHI_CLIENT_S_REGISTERING:
        LOG_I("AVAHI_CLIENT_S_REGISTERING");
        break;
      case AVAHI_CLIENT_S_RUNNING:
        LOG_I("AVAHI_CLIENT_S_RUNNING");
        break;
      case AVAHI_CLIENT_S_COLLISION:
        LOG_I("AVAHI_CLIENT_S_COLLISION");
        break;
      case AVAHI_CLIENT_FAILURE:
        LOG_E("AVAHI_CLIENT_FAILURE: %s", avahi_strerror(avahi_client_errno(aClient)));
        avahi_threaded_poll_stop(mAvahiPoll.get());
        break;
      case AVAHI_CLIENT_CONNECTING:
        LOG_I("AVAHI_CLIENT_CONNECTING");
        break;
    }
  }

  nsresult
  BrowseService(const nsACString& aServiceType,
                BrowseOperator* aOperator)
  {
    mAvahiBrowser = AvahiServiceBrowserPtr(
      avahi_service_browser_new(mAvahiClient.get(),
                                AVAHI_IF_UNSPEC,
                                AVAHI_PROTO_UNSPEC,
                                nsPromiseFlatCString(aServiceType).get(),
                                nullptr,
                                static_cast<AvahiLookupFlags>(0),
                                &AvahiInternal::BrowseCallback,
                                aOperator),
      avahi_service_browser_free);

    return NS_OK;
  }

  static void
  BrowseCallback(AvahiServiceBrowser* aBrowser,
                 AvahiIfIndex aInterface,
                 AvahiProtocol aProtocol,
                 AvahiBrowserEvent aEvent,
                 const char* aName,
                 const char* aType,
                 const char* aDomain,
                 AvahiLookupResultFlags aFlags,
                 void* aUserData)
  {
    MOZ_ASSERT(!NS_IsMainThread());

    BrowseOperator* op = static_cast<BrowseOperator*>(aUserData);
    MOZ_ASSERT(op);

    NS_DispatchToMainThread(
      NS_NewRunnableMethodWithArgs<AvahiServiceBrowser*,
                                   AvahiIfIndex,
                                   AvahiProtocol,
                                   AvahiBrowserEvent,
                                   const nsACString&,
                                   const nsACString&,
                                   const nsACString&,
                                   AvahiLookupResultFlags>(op,
                                                           &BrowseOperator::BrowserReply,
                                                           aBrowser,
                                                           aInterface,
                                                           aProtocol,
                                                           aEvent,
                                                           nsCString(aName),
                                                           nsCString(aType),
                                                           nsCString(aDomain),
                                                           aFlags));
  }

private:
  using AvahiThreadedPollPtr = UniquePtr<AvahiThreadedPoll, decltype(&avahi_threaded_poll_free)>;
  using AvahiClientPtr = UniquePtr<AvahiClient, decltype(&avahi_client_free)>;
  using AvahiServiceBrowserPtr = UniquePtr<AvahiServiceBrowser, decltype(&avahi_service_browser_free)>;

  AvahiThreadedPollPtr mAvahiPoll;
  AvahiClientPtr mAvahiClient;
  AvahiServiceBrowserPtr mAvahiBrowser;
};

AvahiOperator::AvahiOperator()
  : mService(nullptr)
  , mIsCanceled(false)
{
}

AvahiOperator::~AvahiOperator()
{
  Stop();
}

nsresult
AvahiOperator::Start()
{
  if (mIsCanceled) {
    return NS_OK;
  }

  nsresult rv;

  if (NS_WARN_IF(NS_FAILED(rv = Stop()))) {
    return rv;
  }

  MOZ_ASSERT(!mService);
  mService = RefPtr<AvahiInternal>(new AvahiInternal);
  if (NS_WARN_IF(NS_FAILED(rv = mService->Init()))) {
    return rv;
  }

  return NS_OK;
}

nsresult
AvahiOperator::Stop()
{
  if (mService) {
    mService->Close();
    mService = nullptr;
  }

  return NS_OK;
}

void
AvahiOperator::Cancel()
{
  mIsCanceled = true;
}

AvahiOperator::AvahiInternal*
AvahiOperator::GetService() const
{
  return mService.get();
}

BrowseOperator::BrowseOperator(const nsACString& aServiceType,
                               nsIDNSServiceDiscoveryListener* aListener)
  : AvahiOperator()
  , mServiceType(aServiceType)
  , mListener(aListener)
{
}

nsresult
BrowseOperator::Start()
{
  nsresult rv;

  rv = AvahiOperator::Start();
  if (NS_WARN_IF(NS_FAILED(rv))) {
    return rv;
  }

  return GetService()->BrowseService(mServiceType, this);
}

nsresult
BrowseOperator::Stop()
{
  return AvahiOperator::Stop();
}

void
BrowseOperator::BrowserReply(AvahiServiceBrowser* aBrowser,
                             AvahiIfIndex aInterface,
                             AvahiProtocol aProtocol,
                             AvahiBrowserEvent aEvent,
                             const nsACString& aName,
                             const nsACString& aType,
                             const nsACString& aDomain,
                             AvahiLookupResultFlags aFlags)
{
 MOZ_ASSERT(NS_IsMainThread());

  switch (aEvent) {
    case AVAHI_BROWSER_FAILURE:
      LOG_E("AVAHI_BROWSER_FAILURE: %s", avahi_strerror(avahi_client_errno(avahi_service_browser_get_client(aBrowser))));
      Stop();
      break;

    case AVAHI_BROWSER_NEW:
      LOG_I("AVAHI_BROWSER_NEW: service '%s' of type '%s' in domain '%s'\n",
            nsPromiseFlatCString(aName).get(),
            nsPromiseFlatCString(aType).get(),
            nsPromiseFlatCString(aDomain).get());

      // avahi_service_resolver_new();

      break;

    case AVAHI_BROWSER_REMOVE:
      LOG_I("AVAHI_BROWSER_REMOVE: service '%s' of type '%s' in domain '%s'",
            nsPromiseFlatCString(aName).get(),
            nsPromiseFlatCString(aType).get(),
            nsPromiseFlatCString(aDomain).get());
      break;

    case AVAHI_BROWSER_ALL_FOR_NOW:
      LOG_E("AVAHI_BROWSER_ALL_FOR_NOW");
      break;
    case AVAHI_BROWSER_CACHE_EXHAUSTED:
      LOG_E("AVAHI_BROWSER_CACHE_EXHAUSTED");
      break;
  }
}

RegisterOperator::RegisterOperator(nsIDNSServiceInfo* aServiceInfo,
                                   nsIDNSRegistrationListener* aListener)
  : AvahiOperator()
  , mServiceInfo(aServiceInfo)
  , mListener(aListener)
{
}

nsresult
RegisterOperator::Start()
{
  return NS_ERROR_NOT_IMPLEMENTED;
}

nsresult
RegisterOperator::Stop()
{
  return NS_ERROR_NOT_IMPLEMENTED;
}

ResolveOperator::ResolveOperator(nsIDNSServiceInfo* aServiceInfo,
                                 nsIDNSServiceResolveListener* aListener)
  : AvahiOperator()
  , mServiceInfo(aServiceInfo)
  , mListener(aListener)
{
}

nsresult
ResolveOperator::Start()
{
  return NS_ERROR_NOT_IMPLEMENTED;
}

void
ResolveOperator::GetAddrInfor(nsIDNSServiceInfo* aServiceInfo)
{
}

GetAddrInfoOperator::GetAddrInfoOperator(nsIDNSServiceInfo* aServiceInfo,
                                         nsIDNSServiceResolveListener* aListener)
  : AvahiOperator()
  , mServiceInfo(aServiceInfo)
  , mListener(aListener)
{
}

nsresult
GetAddrInfoOperator::Start()
{
  return NS_ERROR_NOT_IMPLEMENTED;
}

} // namespace net
} // namespace mozilla

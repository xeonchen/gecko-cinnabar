/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_netwerk_dns_mdns_libmdns_AvahiOperator_h
#define mozilla_netwerk_dns_mdns_libmdns_AvahiOperator_h

#include <avahi-client/client.h>
#include <avahi-client/lookup.h>
#include "mozilla/Atomics.h"
#include "mozilla/RefCounted.h"
#include "nsCOMPtr.h"
#include "nsIDNSServiceDiscovery.h"
#include "nsIThread.h"
#include "nsString.h"

class AvahiClient;
class AvahiSimplePoll;

namespace mozilla {
namespace net {

class AvahiOperator
{
  NS_INLINE_DECL_THREADSAFE_REFCOUNTING(AvahiOperator)

  class AvahiInternal;

public:
  AvahiOperator();

  virtual nsresult Start();
  virtual nsresult Stop();
  void Cancel();

protected:
  virtual ~AvahiOperator();

  AvahiInternal* GetService() const;

private:

  RefPtr<AvahiInternal> mService;
  Atomic<bool> mIsCanceled;
};

class BrowseOperator final : public AvahiOperator
{
public:
  BrowseOperator(const nsACString& aServiceType,
                 nsIDNSServiceDiscoveryListener* aListener);

  nsresult Start() override;
  nsresult Stop() override;

 void BrowserReply(AvahiServiceBrowser* aBrowser,
                    AvahiIfIndex aInterface,
                    AvahiProtocol aProtocol,
                    AvahiBrowserEvent aEvent,
                    const nsACString& aName,
                    const nsACString& aType,
                    const nsACString& aDomain,
                    AvahiLookupResultFlags aFlags);

private:
  ~BrowseOperator() = default;

  nsCString mServiceType;
  nsCOMPtr<nsIDNSServiceDiscoveryListener> mListener;
};

class RegisterOperator final : public AvahiOperator
{
public:
  RegisterOperator(nsIDNSServiceInfo* aServiceInfo,
                   nsIDNSRegistrationListener* aListener);

  nsresult Start() override;
  nsresult Stop() override;

private:
  ~RegisterOperator() = default;

  nsCOMPtr<nsIDNSServiceInfo> mServiceInfo;
  nsCOMPtr<nsIDNSRegistrationListener> mListener;
};

class ResolveOperator final : public AvahiOperator
{
public:
  ResolveOperator(nsIDNSServiceInfo* aServiceInfo,
                  nsIDNSServiceResolveListener* aListener);

  nsresult Start() override;

private:
  ~ResolveOperator() = default;
  void GetAddrInfor(nsIDNSServiceInfo* aServiceInfo);

  nsCOMPtr<nsIDNSServiceInfo> mServiceInfo;
  nsCOMPtr<nsIDNSServiceResolveListener> mListener;
};

class GetAddrInfoOperator final : public AvahiOperator
{
public:
  GetAddrInfoOperator(nsIDNSServiceInfo* aServiceInfo,
                      nsIDNSServiceResolveListener* aListener);

  nsresult Start() override;

private:
  ~GetAddrInfoOperator() = default;

  nsCOMPtr<nsIDNSServiceInfo> mServiceInfo;
  nsCOMPtr<nsIDNSServiceResolveListener> mListener;
};

} // namespace net
} // namespace mozilla

#endif // mozilla_netwerk_dns_mdns_libmdns_AvahiOperator_h

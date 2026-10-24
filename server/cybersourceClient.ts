import cybersourceRestApi from 'cybersource-rest-client'

const { PaymentsApi, CreatePaymentRequest, RefundApi, RefundPaymentRequest } = cybersourceRestApi as any

// Visa Acceptance Solutions (CyberSource) merchant sandbox — HTTP Signature
// auth via the official cybersource-rest-client SDK. Sandbox host:
// apitest.cybersource.com. Credentials come from .env (never hit the client).

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}. Add it to .env (see .env.example).`)
  return value
}

function merchantConfig() {
  return {
    authenticationType: 'http_signature',
    runEnvironment: process.env.VISA_RUN_ENVIRONMENT || 'apitest.cybersource.com',
    merchantID: requireEnv('VISA_MERCHANT_ID'),
    merchantKeyId: requireEnv('VISA_KEY_ID'),
    merchantsecretKey: requireEnv('VISA_SHARED_SECRET'),
    // This SDK version reads a nested logConfiguration object (not the flat
    // enableLog/logDirectory fields shown in the README, which are for an
    // older SDK version) — omitting it entirely crashes the constructor.
    logConfiguration: { enableLog: false },
  }
}

export type SandboxPaymentResult = { id: string; status: string; reconciliationId?: string }

export function createSandboxPayment(input: { amount: number; currency?: string; referenceCode: string }): Promise<SandboxPaymentResult> {
  return new Promise((resolve, reject) => {
    const apiInstance = new PaymentsApi(merchantConfig())
    const request = new CreatePaymentRequest()
    request.clientReferenceInformation = { code: input.referenceCode }
    request.processingInformation = { capture: true }
    request.paymentInformation = {
      card: {
        number: '4111111111111111',
        expirationMonth: '12',
        expirationYear: String(new Date().getFullYear() + 4),
        securityCode: '123',
      },
    }
    request.orderInformation = {
      amountDetails: { totalAmount: input.amount.toFixed(2), currency: input.currency ?? 'USD' },
      billTo: {
        firstName: 'Test', lastName: 'Shopper', address1: '1295 Charleston Rd',
        locality: 'Mountain View', administrativeArea: 'CA', postalCode: '94043',
        country: 'US', email: 'test@roomwise.app', phoneNumber: '4158880000',
      },
    }
    apiInstance.createPayment(request, (error: any, data: any, response: any) => {
      if (error) {
        const body = response?.text || response?.body || error.message || String(error)
        reject(new Error(`CyberSource payment failed: ${body}`))
        return
      }
      console.log(`[cybersource] payment id=${data?.id} status=${data?.status}`)
      resolve({ id: data?.id, status: data?.status, reconciliationId: data?.reconciliationId })
    })
  })
}

export function refundSandboxPayment(input: { transactionId: string; amount: number; currency?: string; referenceCode: string }): Promise<SandboxPaymentResult> {
  return new Promise((resolve, reject) => {
    const apiInstance = new RefundApi(merchantConfig())
    const request = new RefundPaymentRequest()
    request.clientReferenceInformation = { code: input.referenceCode }
    request.orderInformation = {
      amountDetails: { totalAmount: input.amount.toFixed(2), currency: input.currency ?? 'USD' },
    }
    apiInstance.refundPayment(request, input.transactionId, (error: any, data: any, response: any) => {
      if (error) {
        const body = response?.text || response?.body || error.message || String(error)
        reject(new Error(`CyberSource refund failed: ${body}`))
        return
      }
      console.log(`[cybersource] refund id=${data?.id} status=${data?.status}`)
      resolve({ id: data?.id, status: data?.status, reconciliationId: data?.reconciliationId })
    })
  })
}

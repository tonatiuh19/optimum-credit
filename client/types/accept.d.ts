interface AcceptOpaqueData {
  dataDescriptor: string;
  dataValue: string;
}

interface AcceptDispatchResponse {
  messages: {
    resultCode: "Ok" | "Error";
    message: Array<{ code: string; text: string }>;
  };
  opaqueData?: AcceptOpaqueData;
}

interface Window {
  Accept?: {
    dispatchData: (
      secureData: {
        authData: { apiLoginID: string; clientKey: string };
        cardData: {
          cardNumber: string;
          month: string;
          year: string;
          cardCode: string;
          zip?: string;
          fullName?: string;
        };
      },
      callback: (response: AcceptDispatchResponse) => void,
    ) => void;
  };
}

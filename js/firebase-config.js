// 웹 API 키는 클라이언트에 공개되는 식별자라 비밀키가 아닙니다.
// Maps 키는 여기에 두지 말고 Firebase appConfig/googleMapsApiKey 에만 넣으세요.
export const firebaseConfig = {
  apiKey: "AIzaSyC6zXh7-T9W4SFyKJv1MmZmCK6dgkaFpQg",
  authDomain: "tripplanner-531c6.firebaseapp.com",
  databaseURL: "https://tripplanner-531c6-default-rtdb.firebaseio.com",
  projectId: "tripplanner-531c6",
  storageBucket: "tripplanner-531c6.firebasestorage.app",
  messagingSenderId: "307647964357",
  appId: "1:307647964357:web:6f9ce8af6a7e23b5db7cac",
};

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL && firebaseConfig.projectId);
}

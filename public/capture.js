const input = document.querySelector("#imageInput");
const preview = document.querySelector("#preview");
const previewWrap = document.querySelector(".preview-wrap");
const sendBtn = document.querySelector("#sendBtn");
const statusLine = document.querySelector("#status");
const note = document.querySelector("#note");
const confirmation = document.querySelector("#confirmation");

let imageDataUrl = "";
let sending = false;

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file || sending) return;
  confirmation.hidden = true;
  setStatus("Preparing image...");
  imageDataUrl = await resizeImage(file, 1800, 0.82);
  preview.src = imageDataUrl;
  previewWrap.hidden = false;
  await sendCurrentImage();
});

sendBtn.addEventListener("click", sendCurrentImage);

async function sendCurrentImage() {
  if (!imageDataUrl) return;
  sending = true;
  sendBtn.disabled = true;
  sendBtn.innerHTML = `<span class="btn-icon">↑</span> Sending`;
  setStatus("Sending to dashboard...");

  try {
    const response = await fetch("/api/captures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: imageDataUrl,
        note: note.value,
        source: "phone"
      })
    });

    if (!response.ok) throw new Error(await response.text());
    showConfirmation();
    setStatus("Sent. Snap another screenshot when ready.");
    input.value = "";
    imageDataUrl = "";
    previewWrap.hidden = true;
  } catch (error) {
    console.error(error);
    setStatus("Upload failed. Check that the desktop app is still running.");
  } finally {
    sending = false;
    sendBtn.disabled = true;
    sendBtn.innerHTML = `<span class="btn-icon">↑</span> Auto-send ready`;
  }
}

function showConfirmation() {
  confirmation.hidden = false;
  confirmation.classList.remove("is-visible");
  requestAnimationFrame(() => confirmation.classList.add("is-visible"));
}

function setStatus(text) {
  statusLine.textContent = text;
}

function resizeImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d", { alpha: false });
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

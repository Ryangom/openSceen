document.addEventListener('DOMContentLoaded', () => {
  const btnGrant = document.getElementById('btn-grant');
  const errorMsg = document.getElementById('error-msg');

  btnGrant.addEventListener('click', async () => {
    errorMsg.style.display = 'none';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the stream immediately, we only needed permission
      stream.getTracks().forEach((track) => track.stop());
      
      // Update UI to show success
      btnGrant.classList.add('success');
      btnGrant.innerHTML = '<span>✅ Permission Granted!</span>';
      
      setTimeout(() => {
        window.close(); // Close the tab automatically after success
      }, 2000);

    } catch (err) {
      errorMsg.style.display = 'block';
      if (err.name === 'NotAllowedError') {
        errorMsg.textContent = 'Permission was denied. Please click the lock icon in the address bar to allow microphone access.';
      } else {
        errorMsg.textContent = `Error: ${err.message || 'Could not access microphone'}`;
      }
    }
  });
});

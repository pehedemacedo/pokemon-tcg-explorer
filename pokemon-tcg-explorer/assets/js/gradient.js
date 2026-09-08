let mousePosition = {
    x: 0,
    y: 0
};

document.addEventListener("mousemove", (mouse) => {
    mousePosition = {
        x: mouse.clientX,
        y: mouse.clientY
    };
});

const loop = () => {
    const gradientElement = document.getElementById("gradient");

    gradientElement.style.transform = `translate(${mousePosition.x}px, ${mousePosition.y}px)`;

    // Request the next animation frame
    window.requestAnimationFrame(loop);
};

// Start the animation loop
window.requestAnimationFrame(loop);

fetch("/assets/navbar.html")
    .then(response => {
        if (!response.ok) {
            throw new Error("Não foi possível carregar a navbar.");
        }

        return response.text();
    })
    .then(data => {

        const navbarContainer = document.getElementById("Navbar");

        if (!navbarContainer) {
            console.error("Elemento #Navbar não encontrado.");
            return;
        }

        navbarContainer.innerHTML = data;

        // Marca como "active" o link correspondente à página atual
        const navLinks = navbarContainer.querySelectorAll(".nav-link");
        const currentPage = location.pathname.split("/").pop() || "index.html";

        navLinks.forEach(link => {
            const linkPage = link.getAttribute("href").split("/").pop();
            const isActive = linkPage === currentPage;

            link.classList.toggle("active", isActive);

            if (isActive) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
        });



    })
    .catch(error => {
        console.error("Erro ao carregar a navbar:", error);
    });